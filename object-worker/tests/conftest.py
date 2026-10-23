import sys
from pathlib import Path

# The worker is a flat module directory (like face-worker); make it importable.
WORKER_ROOT = Path(__file__).resolve().parent.parent
if str(WORKER_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKER_ROOT))
