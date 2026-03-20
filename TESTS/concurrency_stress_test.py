import json
import time
import threading
import requests

URL = "http://localhost:8000/api/optimize"
with open("medium_city.json") as f:
    geojson = json.load(f)

payload = {"geojson": geojson}

results = []
errors = []
lock = threading.Lock()

def send_request(idx):
    start = time.perf_counter()
    try:
        r = requests.post(URL, json=payload, timeout=120)
        elapsed = time.perf_counter() - start
        with lock:
            if r.status_code == 200:
                results.append(elapsed)
                print(f"  [{idx}] OK  {elapsed:.3f}s")
            else:
                errors.append((idx, r.status_code, r.text[:200]))
                print(f"  [{idx}] ERR {r.status_code} {elapsed:.3f}s")
    except Exception as e:
        elapsed = time.perf_counter() - start
        with lock:
            errors.append((idx, "exception", str(e)))
            print(f"  [{idx}] EXC {e} after {elapsed:.3f}s")

threads = [threading.Thread(target=send_request, args=(i,)) for i in range(10)]
wall_start = time.perf_counter()
for t in threads:
    t.start()
for t in threads:
    t.join()
wall_end = time.perf_counter()

print()
print(f"=== Concurrency Results (10 simultaneous requests) ===")
print(f"  Successful:      {len(results)}/10")
print(f"  Errors/Drops:    {len(errors)}")
if results:
    print(f"  Avg resp time:   {sum(results)/len(results):.3f}s")
    print(f"  Min resp time:   {min(results):.3f}s")
    print(f"  Max resp time:   {max(results):.3f}s")
print(f"  Wall-clock time: {wall_end - wall_start:.3f}s")
if errors:
    print("  Error details:")
    for e in errors:
        print(f"    {e}")
