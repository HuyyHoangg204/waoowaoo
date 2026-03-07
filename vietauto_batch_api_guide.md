# Hướng Dẫn Implement VietAuto Batch API

> Tài liệu đầy đủ để implement lại VietAuto Batch API (tạo ảnh + tạo video) vào dự án khác.

---

## 1. Cấu Hình Môi Trường

```env
VIETAUTO_API_KEY=ak_live_xxxxxxxxxxxx
VIETAUTO_PROJECT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

**Base URL**: `https://vietauto.ai/api/veo`

---

## 2. Tổng Quan Các Endpoint

| Endpoint                   | Method | Chức năng                                      |
| -------------------------- | ------ | ---------------------------------------------- |
| `/veo/create-image`        | POST   | Tạo ảnh (single hoặc batch N prompts)          |
| `/veo/image-to-video`      | POST   | Tạo video từ ảnh (single hoặc batch N prompts) |
| `/veo/video?id={video_id}` | GET    | Poll trạng thái + lấy kết quả                  |

**Flow chung**: `POST create → nhận video_id → Poll GET /video → khi SUCCESS → download file_url`

---

## 3. Source Code Đầy Đủ (Python)

### 3.1. Service Class — Copy nguyên file này

```python
import os
import time
import json
import requests
from typing import Optional, Dict, Any, List
from concurrent.futures import ThreadPoolExecutor, as_completed

# ============================================================
# CẤU HÌNH
# ============================================================
VIETAUTO_API_KEY = os.getenv("VIETAUTO_API_KEY")
VIETAUTO_PROJECT_ID = os.getenv("VIETAUTO_PROJECT_ID")
VIETAUTO_API_URL = "https://vietauto.ai/api/veo"


class VietAutoService:
    """
    Service wrapper cho VietAuto.ai API.
    Hỗ trợ:
      - Tạo ảnh đơn/batch
      - Tạo video từ ảnh đơn/batch
      - Progressive polling (download từng item khi xong)
    """

    # ============================================================
    # HELPER: Map size → ratio
    # ============================================================
    def _map_size_to_ratio(self, size: str) -> str:
        if size in ("720x1280", "9:16"):
            return "9:16"
        return "16:9"  # Default cho 1280x720, 1024x1024, etc.

    # ============================================================
    # HELPER: Download file từ URL
    # ============================================================
    def _download_file(self, url: str, file_type: str = "image") -> Dict[str, Any]:
        """Download ảnh/video từ URL trả về bytes."""
        try:
            timeout = 120 if file_type == "video" else 30
            resp = requests.get(url, timeout=timeout)
            if resp.status_code == 200:
                data_key = "video_data" if file_type == "video" else "image_data"
                fmt = "mp4" if file_type == "video" else "jpeg"
                return {"status": "success", data_key: resp.content, "format": fmt}
            return {"status": "error", "message": f"Download failed: HTTP {resp.status_code}"}
        except Exception as e:
            return {"status": "error", "message": f"Download error: {e}"}

    # ============================================================
    # 1. TẠO ẢNH ĐƠN (Single prompt)
    # ============================================================
    def create_image(
        self, prompt: str, files: List[str] = None,
        screen_ratio: str = "16:9", model: str = "GEM_PIX_2"
    ) -> Dict[str, Any]:
        """
        POST /veo/create-image với 1 prompt.

        Args:
            prompt: Câu prompt mô tả ảnh cần tạo
            files: Danh sách đường dẫn ảnh tham chiếu (optional)
            screen_ratio: "16:9" hoặc "9:16"
            model: "GEM_PIX" hoặc "GEM_PIX_2"

        Returns: { status: 'success', image_data: bytes, format: 'jpeg' } hoặc error
        """
        if not VIETAUTO_API_KEY or not VIETAUTO_PROJECT_ID:
            return {"status": "error", "message": "VIETAUTO_API_KEY/PROJECT_ID not configured"}

        try:
            form_data = {
                'action_type': (None, 'CREATE_IMAGE'),
                'name': (None, f'gen_{int(time.time())}'),
                'model': (None, model),
                'screen_ratio': (None, screen_ratio),
                'project_id': (None, VIETAUTO_PROJECT_ID),
                'prompts': (None, json.dumps([prompt])),
            }

            # Xử lý file đính kèm
            file_tuples = []
            if files and len(files) > 0:
                form_data['file_prompt'] = (None, json.dumps([len(files)]))
                for fpath in files:
                    if os.path.exists(fpath):
                        file_tuples.append(
                            ('files', (os.path.basename(fpath), open(fpath, 'rb'), 'image/jpeg'))
                        )
            else:
                form_data['file_prompt'] = (None, json.dumps([0]))

            headers = {'Authorization': f'Bearer {VIETAUTO_API_KEY}'}

            response = requests.post(
                f"{VIETAUTO_API_URL}/create-image",
                files=list(form_data.items()) + file_tuples,
                headers=headers,
                timeout=30
            )

            # Close file handles
            for _, ft in file_tuples:
                if hasattr(ft[1], 'close'):
                    ft[1].close()

            if response.status_code != 200:
                return {"status": "error", "message": f"API error {response.status_code}: {response.text}"}

            video_id = response.json().get("video_id")
            if not video_id:
                return {"status": "error", "message": f"No video_id in response"}

            # Poll until done
            return self._poll_single(video_id, file_type="image")

        except Exception as e:
            return {"status": "error", "message": str(e)}

    # ============================================================
    # 2. TẠO ẢNH BATCH (N prompts trong 1 API call)
    # ============================================================
    def create_batch_images(
        self, items: List[Dict[str, Any]],
        screen_ratio: str = "16:9", model: str = "GEM_PIX_2",
        on_progress: callable = None
    ) -> List[Dict[str, Any]]:
        """
        Gửi N prompts + files trong 1 API call duy nhất.

        Args:
            items: List of dicts:
                - "prompt": str (bắt buộc)
                - "files": List[str] (optional, đường dẫn ảnh tham chiếu)
            screen_ratio: "16:9" hoặc "9:16"
            model: "GEM_PIX" hoặc "GEM_PIX_2"
            on_progress: callback(downloaded_count, total_count) (optional)

        Returns: List kết quả theo thứ tự input.
            Mỗi item: { status: 'success', image_data: bytes } hoặc error

        VietAuto Status flow: NEW → PROCESSING → SUCCESS/FAILED
        """
        if not VIETAUTO_API_KEY or not VIETAUTO_PROJECT_ID:
            return [{"status": "error", "message": "Not configured"}] * len(items)
        if not items:
            return []

        try:
            prompts = [item["prompt"] for item in items]
            file_prompt = [len(item.get("files", [])) for item in items]

            # Thu thập tất cả files theo thứ tự
            all_files = []
            for item in items:
                for fpath in item.get("files", []):
                    if os.path.exists(fpath):
                        all_files.append(fpath)

            form_data = {
                'action_type': (None, 'CREATE_IMAGE'),
                'name': (None, f'batch_{int(time.time())}'),
                'model': (None, model),
                'screen_ratio': (None, screen_ratio),
                'project_id': (None, VIETAUTO_PROJECT_ID),
                'prompts': (None, json.dumps(prompts)),
                'file_prompt': (None, json.dumps(file_prompt)),
            }

            # Open files
            file_tuples = []
            opened_handles = []
            for fpath in all_files:
                fh = open(fpath, 'rb')
                opened_handles.append(fh)
                file_tuples.append(('files', (os.path.basename(fpath), fh, 'image/jpeg')))

            headers = {'Authorization': f'Bearer {VIETAUTO_API_KEY}'}

            try:
                response = requests.post(
                    f"{VIETAUTO_API_URL}/create-image",
                    files=list(form_data.items()) + file_tuples,
                    headers=headers,
                    timeout=30
                )
            finally:
                for fh in opened_handles:
                    fh.close()

            if response.status_code != 200:
                err = f"API error {response.status_code}: {response.text}"
                return [{"status": "error", "message": err}] * len(items)

            video_id = response.json().get("video_id")
            if not video_id:
                return [{"status": "error", "message": "No video_id"}] * len(items)

            print(f"✅ Batch task created: video_id={video_id} ({len(items)} items)")

            # Progressive poll
            return self._poll_batch(video_id, len(items), "image", on_progress=on_progress)

        except Exception as e:
            return [{"status": "error", "message": str(e)}] * len(items)

    # ============================================================
    # 3. TẠO VIDEO TỪ ẢNH - ĐƠN (Image-to-Video single)
    # ============================================================
    def image_to_video(
        self, prompt: str, image_path: str,
        model: str = "VEO_3.1_FAST", screen_ratio: str = "16:9"
    ) -> Dict[str, Any]:
        """
        POST /veo/image-to-video cho 1 shot.

        Args:
            prompt: Motion prompt (mô tả chuyển động, KHÔNG mô tả lại nhân vật)
            image_path: Đường dẫn ảnh gốc (local path)
            model: "VEO_3.1_FAST" hoặc "VEO_3.1_FAST_LOWER_PRIORITY"
            screen_ratio: "16:9" hoặc "9:16"

        Returns: { status: 'success', video_data: bytes, format: 'mp4' } hoặc error
        """
        if not VIETAUTO_API_KEY or not VIETAUTO_PROJECT_ID:
            return {"status": "error", "message": "Not configured"}
        if not os.path.exists(image_path):
            return {"status": "error", "message": f"Image not found: {image_path}"}

        try:
            form_data = {
                'action_type': (None, 'IMAGE_TO_VIDEO'),
                'name': (None, f'i2v_{int(time.time())}'),
                'model': (None, model),
                'screen_ratio': (None, screen_ratio),
                'project_id': (None, VIETAUTO_PROJECT_ID),
                'prompts': (None, json.dumps([prompt])),
            }

            fh = open(image_path, 'rb')
            file_tuples = [('files', (os.path.basename(image_path), fh, 'image/jpeg'))]
            headers = {'Authorization': f'Bearer {VIETAUTO_API_KEY}'}

            try:
                response = requests.post(
                    f"{VIETAUTO_API_URL}/image-to-video",
                    files=list(form_data.items()) + file_tuples,
                    headers=headers,
                    timeout=30
                )
            finally:
                fh.close()

            if response.status_code != 200:
                return {"status": "error", "message": f"API error {response.status_code}: {response.text}"}

            video_id = response.json().get("video_id")
            if not video_id:
                return {"status": "error", "message": "No video_id"}

            return self._poll_single(video_id, file_type="video", max_wait=600, interval=8)

        except Exception as e:
            return {"status": "error", "message": str(e)}

    # ============================================================
    # 4. TẠO VIDEO BATCH (N prompts+images trong 1 API call) ⭐
    # ============================================================
    def batch_image_to_video(
        self, items: List[Dict[str, str]],
        model: str = "VEO_3.1_FAST", screen_ratio: str = "16:9",
        on_item_complete: callable = None
    ) -> List[Dict[str, Any]]:
        """
        Gửi N prompts + images trong 1 API call duy nhất.

        Args:
            items: List of dicts:
                - "prompt": str (flattened motion prompt)
                - "image_path": str (local path to image)
                - "shot_id": str (for tracking)
            model: "VEO_3.1_FAST" hoặc "VEO_3.1_FAST_LOWER_PRIORITY"
            screen_ratio: "16:9" hoặc "9:16"
            on_item_complete: callback(index, shot_id, result) — gọi khi mỗi item xong

        Returns: List of {status, video_data, shot_id} theo thứ tự input.
        """
        if not VIETAUTO_API_KEY or not VIETAUTO_PROJECT_ID:
            return [{"status": "error", "message": "Not configured"}] * len(items)
        if not items:
            return []

        n = len(items)
        prompts = [item["prompt"] for item in items]
        image_paths = [item["image_path"] for item in items]

        try:
            form_data = {
                'action_type': (None, 'IMAGE_TO_VIDEO'),
                'name': (None, f'batch_i2v_{int(time.time())}'),
                'model': (None, model),
                'screen_ratio': (None, screen_ratio),
                'project_id': (None, VIETAUTO_PROJECT_ID),
                'prompts': (None, json.dumps(prompts)),
            }

            # Open all image files
            opened_handles = []
            file_tuples = []
            for img_path in image_paths:
                fh = open(img_path, 'rb')
                opened_handles.append(fh)
                file_tuples.append(('files', (os.path.basename(img_path), fh, 'image/jpeg')))

            headers = {'Authorization': f'Bearer {VIETAUTO_API_KEY}'}

            try:
                response = requests.post(
                    f"{VIETAUTO_API_URL}/image-to-video",
                    files=list(form_data.items()) + file_tuples,
                    headers=headers,
                    timeout=60
                )
            finally:
                for fh in opened_handles:
                    fh.close()

            if response.status_code != 200:
                err = f"API error {response.status_code}: {response.text}"
                return [{"status": "error", "message": err, "shot_id": items[i]["shot_id"]} for i in range(n)]

            video_id = response.json().get("video_id")
            if not video_id:
                return [{"status": "error", "message": "No video_id", "shot_id": items[i]["shot_id"]} for i in range(n)]

            print(f"✅ Batch I2V task created: video_id={video_id} ({n} items)")

            # Progressive poll with callback
            return self._poll_batch_with_tracking(
                video_id, items, on_item_complete=on_item_complete
            )

        except Exception as e:
            return [{"status": "error", "message": str(e), "shot_id": items[i]["shot_id"]} for i in range(n)]

    # ============================================================
    # 5. CONCURRENT BATCH (chia chunks + multi-thread) ⭐⭐
    # ============================================================
    def generate_batch_images_concurrent(
        self, items: List[Dict[str, Any]],
        size: str = "1280x720", max_per_chunk: int = 40,
        on_progress: callable = None
    ) -> List[Dict[str, Any]]:
        """
        Chia items thành chunks, gửi song song nhiều batch API call.

        Args:
            items: [{"prompt": str, "files": [str]}]
            size: "1280x720" hoặc "720x1280"
            max_per_chunk: Số items tối đa mỗi API call (default 40)
            on_progress: callback(completed_count, total_count)

        Returns: List kết quả theo thứ tự input.
        """
        if not items:
            return []

        screen_ratio = self._map_size_to_ratio(size)

        # Chia chunks
        chunk_size = min(max_per_chunk, max(1, (len(items) + 3) // 4))
        chunks = [items[i:i + chunk_size] for i in range(0, len(items), chunk_size)]

        print(f"🔄 Splitting {len(items)} items into {len(chunks)} chunks ({chunk_size}/chunk)")

        final_results = [None] * len(items)

        def process_chunk(chunk_idx, chunk_items):
            return chunk_idx, self.create_batch_images(
                items=chunk_items,
                screen_ratio=screen_ratio,
                model="GEM_PIX_2",
            )

        with ThreadPoolExecutor(max_workers=len(chunks)) as executor:
            futures = {
                executor.submit(process_chunk, idx, chunk): idx
                for idx, chunk in enumerate(chunks)
            }

            for future in as_completed(futures):
                chunk_idx, chunk_results = future.result()
                start_idx = chunk_idx * chunk_size
                for i, res in enumerate(chunk_results):
                    if start_idx + i < len(final_results):
                        final_results[start_idx + i] = res

                if on_progress:
                    completed = sum(1 for r in final_results if r and r.get("status") == "success")
                    on_progress(completed, len(items))

        # Fill gaps
        for i in range(len(final_results)):
            if final_results[i] is None:
                final_results[i] = {"status": "error", "message": "Chunk processing failed"}

        return final_results

    def generate_batch_videos_concurrent(
        self, items: List[Dict[str, str]],
        model: str = "VEO_3.1_FAST",
        concurrency: int = 4, batch_size: int = 40,
        on_item_complete: callable = None
    ) -> List[Dict[str, Any]]:
        """
        Chia items thành chunks, gửi song song nhiều batch I2V API call.

        Args:
            items: [{"prompt": str, "image_path": str, "shot_id": str}]
            concurrency: Số API call chạy song song (max 8)
            batch_size: Số items mỗi API call (max 300)
            on_item_complete: callback(index, shot_id, result)

        Returns: List kết quả theo thứ tự input.
        """
        if not items:
            return []

        concurrency = min(concurrency, 8)
        batch_size = min(batch_size, 300)
        chunks = [items[i:i + batch_size] for i in range(0, len(items), batch_size)]

        print(f"🎬 {len(items)} videos → {len(chunks)} batches x{concurrency} concurrent")

        all_results = [None] * len(items)

        def process_chunk(chunk_idx, chunk):
            return chunk_idx, self.batch_image_to_video(
                items=chunk, model=model,
                on_item_complete=on_item_complete
            )

        with ThreadPoolExecutor(max_workers=concurrency) as executor:
            futures = {
                executor.submit(process_chunk, idx, chunk): idx
                for idx, chunk in enumerate(chunks)
            }
            for future in as_completed(futures):
                try:
                    chunk_idx, results = future.result()
                    start = chunk_idx * batch_size
                    for i, res in enumerate(results):
                        if start + i < len(all_results):
                            all_results[start + i] = res
                except Exception as e:
                    print(f"❌ Chunk error: {e}")

        for i in range(len(all_results)):
            if all_results[i] is None:
                all_results[i] = {"status": "error", "message": "Processing failed"}

        return all_results

    # ============================================================
    # POLLING: Single item
    # ============================================================
    def _poll_single(
        self, video_id: str, file_type: str = "image",
        max_wait: int = 500, interval: int = 5
    ) -> Dict[str, Any]:
        """
        Poll GET /veo/video?id={video_id} cho 1 item.

        Response format: list of items, mỗi item có:
          - status: "NEW" | "PROCESSING" | "SUCCESS" | "FAILED" | "ERROR"
          - file_url: URL download khi SUCCESS
          - message: Error message khi FAILED
        """
        headers = {'Authorization': f'Bearer {VIETAUTO_API_KEY}'}
        elapsed = 0

        while elapsed < max_wait:
            try:
                resp = requests.get(
                    f"{VIETAUTO_API_URL}/video",
                    params={"id": video_id},
                    headers=headers,
                    timeout=15
                )

                if resp.status_code == 200:
                    items = resp.json()
                    if isinstance(items, list) and len(items) > 0:
                        item = items[0]
                        status = item.get("status", "").upper()

                        if status == "SUCCESS":
                            file_url = item.get("file_url")
                            if file_url:
                                return self._download_file(file_url, file_type)
                            return {"status": "error", "message": "SUCCESS but no file_url"}

                        elif status in ("FAILED", "ERROR"):
                            msg = item.get("message", "Unknown error")
                            return {"status": "error", "message": f"Generation failed: {msg}"}

            except Exception as e:
                print(f"⚠️ Poll error: {e}")

            time.sleep(interval)
            elapsed += interval

        return {"status": "error", "message": f"Timeout after {max_wait}s"}

    # ============================================================
    # POLLING: Batch — Progressive Download ⭐
    # ============================================================
    def _poll_batch(
        self, video_id: str, expected_count: int,
        file_type: str = "image",
        max_wait: int = 1800, interval: int = 5,
        on_progress: callable = None
    ) -> List[Dict[str, Any]]:
        """
        Poll GET /veo/video?id={video_id} cho batch.
        Download từng item NGAY KHI nó SUCCESS (progressive).

        API Response format: list of N items (cùng thứ tự với prompts đã gửi)
        Mỗi item: { status, file_url, message }
        """
        headers = {'Authorization': f'Bearer {VIETAUTO_API_KEY}'}
        results = [None] * expected_count
        downloaded = set()
        elapsed = 0

        while elapsed < max_wait:
            try:
                resp = requests.get(
                    f"{VIETAUTO_API_URL}/video",
                    params={"id": video_id},
                    headers=headers,
                    timeout=15
                )

                if resp.status_code == 200:
                    data = resp.json()
                    if isinstance(data, list):
                        for idx, item in enumerate(data):
                            if idx in downloaded or idx >= expected_count:
                                continue

                            status = item.get("status", "").upper()

                            if status == "SUCCESS":
                                file_url = item.get("file_url", "")
                                if file_url:
                                    dl = self._download_file(file_url, file_type)
                                    results[idx] = dl
                                    downloaded.add(idx)
                                    if dl["status"] == "success":
                                        print(f"📥 Item {idx+1}/{len(data)}: OK")
                                else:
                                    results[idx] = {"status": "error", "message": "No file_url"}
                                    downloaded.add(idx)

                            elif status in ("FAILED", "ERROR"):
                                msg = item.get("message", "Unknown")
                                results[idx] = {"status": "error", "message": msg}
                                downloaded.add(idx)

                        if on_progress:
                            on_progress(len(downloaded), len(data))

                        if elapsed % 30 == 0:
                            print(f"⏳ t={elapsed}s: {len(downloaded)}/{len(data)} done")

                        # Tất cả xong
                        if len(downloaded) >= len(data):
                            print(f"✅ All {len(data)} items complete at t={elapsed}s")
                            return results[:len(data)]

            except Exception as e:
                print(f"⚠️ Poll error: {e}")

            time.sleep(interval)
            elapsed += interval

        # Timeout
        for i in range(expected_count):
            if results[i] is None:
                results[i] = {"status": "error", "message": f"Timeout after {max_wait}s"}
        return results

    # ============================================================
    # POLLING: Batch I2V — với shot_id tracking + callback
    # ============================================================
    def _poll_batch_with_tracking(
        self, video_id: str, items: List[Dict],
        max_wait: int = 1800, interval: int = 10,
        on_item_complete: callable = None
    ) -> List[Dict[str, Any]]:
        """
        Giống _poll_batch nhưng theo dõi shot_id và gọi callback khi mỗi item xong.
        """
        headers = {'Authorization': f'Bearer {VIETAUTO_API_KEY}'}
        n = len(items)
        results = [None] * n
        downloaded = set()
        elapsed = 0

        while elapsed < max_wait:
            try:
                resp = requests.get(
                    f"{VIETAUTO_API_URL}/video",
                    params={"id": video_id},
                    headers=headers,
                    timeout=15
                )

                if resp.status_code == 200:
                    data = resp.json()
                    if isinstance(data, list):
                        for idx, item in enumerate(data):
                            if idx in downloaded or idx >= n:
                                continue

                            status = item.get("status", "").upper()
                            shot_id = items[idx].get("shot_id", f"item_{idx}")

                            if status == "SUCCESS":
                                file_url = item.get("file_url", "")
                                if file_url:
                                    dl = self._download_file(file_url, "video")
                                    dl["shot_id"] = shot_id
                                    results[idx] = dl
                                    downloaded.add(idx)
                                    if on_item_complete:
                                        on_item_complete(idx, shot_id, dl)
                                else:
                                    results[idx] = {"status": "error", "message": "No file_url", "shot_id": shot_id}
                                    downloaded.add(idx)

                            elif status in ("FAILED", "ERROR"):
                                msg = item.get("message", "Unknown")
                                results[idx] = {"status": "error", "message": msg, "shot_id": shot_id}
                                downloaded.add(idx)
                                if on_item_complete:
                                    on_item_complete(idx, shot_id, results[idx])

                        if elapsed % 30 == 0:
                            print(f"⏳ t={elapsed}s: {len(downloaded)}/{len(data)} done")

                        if len(downloaded) >= len(data):
                            return results[:len(data)]

            except Exception as e:
                print(f"⚠️ Poll error: {e}")

            time.sleep(interval)
            elapsed += interval

        for i in range(n):
            if results[i] is None:
                results[i] = {"status": "error", "message": f"Timeout", "shot_id": items[i].get("shot_id")}
        return results


# Singleton
vietauto_service = VietAutoService()
```

---

## 4. Cách Sử Dụng — Ví Dụ

### 4.1. Tạo 1 ảnh đơn

```python
from vietauto_service import vietauto_service

result = vietauto_service.create_image(
    prompt="A cute cat sitting on a windowsill, golden hour",
    screen_ratio="16:9",
    model="GEM_PIX_2"
)

if result["status"] == "success":
    with open("output.jpg", "wb") as f:
        f.write(result["image_data"])
```

### 4.2. Tạo batch ảnh (10 ảnh trong 1 API call)

```python
items = [
    {"prompt": "Scene 1: A warrior in the forest", "files": ["ref_char.jpg"]},
    {"prompt": "Scene 2: A dragon flying", "files": []},
    {"prompt": "Scene 3: A castle at dawn"},
    # ... lên tới 40 items mỗi call
]

results = vietauto_service.create_batch_images(
    items=items,
    screen_ratio="16:9",
    on_progress=lambda done, total: print(f"Progress: {done}/{total}")
)

for i, res in enumerate(results):
    if res["status"] == "success":
        with open(f"scene_{i}.jpg", "wb") as f:
            f.write(res["image_data"])
```

### 4.3. Tạo 1 video từ ảnh

```python
result = vietauto_service.image_to_video(
    prompt="The character walks slowly forward, camera tracking dolly in",
    image_path="scene_01.jpg",
    model="VEO_3.1_FAST"
)

if result["status"] == "success":
    with open("scene_01.mp4", "wb") as f:
        f.write(result["video_data"])
```

### 4.4. Tạo batch video (40 videos trong 1 API call) ⭐

```python
items = [
    {"prompt": "Character walks left", "image_path": "shot_01.jpg", "shot_id": "S1B1_01"},
    {"prompt": "Character runs",       "image_path": "shot_02.jpg", "shot_id": "S1B1_02"},
    # ... lên tới 300 items
]

def on_done(idx, shot_id, result):
    if result["status"] == "success":
        with open(f"{shot_id}.mp4", "wb") as f:
            f.write(result["video_data"])
        print(f"✅ {shot_id} saved!")

results = vietauto_service.batch_image_to_video(
    items=items,
    model="VEO_3.1_FAST",
    on_item_complete=on_done
)
```

### 4.5. Concurrent batch (chia chunks + multi-thread) ⭐⭐

```python
# 200 ảnh → chia 5 chunks x 40 → gửi 5 API call song song
items = [{"prompt": f"Scene {i}", "files": []} for i in range(200)]

results = vietauto_service.generate_batch_images_concurrent(
    items=items,
    size="1280x720",
    max_per_chunk=40,
    on_progress=lambda d, t: print(f"{d}/{t}")
)

# 200 videos → 5 chunks x 40 → 4 concurrent workers
video_items = [
    {"prompt": f"Action {i}", "image_path": f"shot_{i}.jpg", "shot_id": f"S{i}"}
    for i in range(200)
]

results = vietauto_service.generate_batch_videos_concurrent(
    items=video_items,
    concurrency=4,
    batch_size=40,
    on_item_complete=lambda idx, sid, res: print(f"{sid}: {res['status']}")
)
```

---

## 5. Quan Trọng: Trường `file_prompt`

Đây là trường **đặc biệt** của VietAuto API để map files → prompts:

```python
# Ví dụ: 3 prompts, prompt 0 có 2 files, prompt 1 có 1 file, prompt 2 không có file
prompts = ["prompt_0", "prompt_1", "prompt_2"]
file_prompt = [2, 1, 0]  # Số file của mỗi prompt

# Files gửi theo thứ tự: file_0a, file_0b (cho prompt 0), file_1a (cho prompt 1)
```

**Quy tắc**: `sum(file_prompt)` phải bằng tổng số files được upload.

---

## 6. API Response Format

### POST create-image / image-to-video

```json
{
  "video_id": "abc123-def456-..."
}
```

### GET /video?id={video_id}

```json
[
  {
    "status": "SUCCESS", // "NEW" | "PROCESSING" | "SUCCESS" | "FAILED" | "ERROR"
    "file_url": "https://...", // URL download khi SUCCESS
    "message": "" // Error message khi FAILED
  },
  {
    "status": "PROCESSING",
    "file_url": "",
    "message": ""
  }
]
```

> **Lưu ý**: Response là một **array** — mỗi phần tử tương ứng 1 prompt theo thứ tự gửi.

---

## 7. Thông Số Quan Trọng

| Param           | Giá trị                                           | Mô tả            |
| --------------- | ------------------------------------------------- | ---------------- |
| `model` (ảnh)   | `GEM_PIX`, `GEM_PIX_2`                            | Model tạo ảnh    |
| `model` (video) | `VEO_3.1_FAST`, `VEO_3.1_FAST_LOWER_PRIORITY`     | Model tạo video  |
| `action_type`   | `CREATE_IMAGE`, `IMAGE_TO_VIDEO`                  | Loại tác vụ      |
| `screen_ratio`  | `16:9`, `9:16`                                    | Tỷ lệ khung hình |
| Batch max items | ~40/call (ảnh), ~300/call (video)                 | Giới hạn batch   |
| Poll interval   | 5s (ảnh), 8-10s (video)                           | Khoảng cách poll |
| Max wait        | 500s (ảnh), 600s (đơn video), 1800s (batch video) | Timeout          |

---

## 8. Tích Hợp FastAPI (Optional)

Nếu dự án dùng FastAPI, đây là mẫu endpoint batch + progress tracking:

```python
from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel
import threading

router = APIRouter()
BATCH_PROGRESS: dict = {}

class BatchRequest(BaseModel):
    project_id: str
    items: list  # [{"prompt": str, "image_path": str, "shot_id": str}]
    concurrency: int = 4
    batch_size: int = 40

@router.post("/batch-generate")
def start_batch(req: BatchRequest, background_tasks: BackgroundTasks):
    BATCH_PROGRESS[req.project_id] = {
        "status": "processing",
        "completed": 0,
        "failed": 0,
        "total": len(req.items),
    }

    def run():
        try:
            def on_done(idx, shot_id, result):
                if result["status"] == "success" and result.get("video_data"):
                    # Save to disk...
                    BATCH_PROGRESS[req.project_id]["completed"] += 1
                else:
                    BATCH_PROGRESS[req.project_id]["failed"] += 1

            vietauto_service.generate_batch_videos_concurrent(
                items=req.items,
                concurrency=req.concurrency,
                batch_size=req.batch_size,
                on_item_complete=on_done
            )
        finally:
            BATCH_PROGRESS[req.project_id]["status"] = "completed"

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    return {"status": "started", "total": len(req.items)}

@router.get("/batch-status/{project_id}")
def get_status(project_id: str):
    return BATCH_PROGRESS.get(project_id, {"status": "idle"})
```

---

> [!TIP]
> **Progressive Polling** là key: không cần đợi tất cả xong, download từng item ngay khi `SUCCESS` → tiết kiệm RAM và cải thiện UX.
