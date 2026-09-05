"""Hardware detection for CPU, RAM, and NVIDIA CUDA GPU."""
import os
import sys
from typing import Optional
from app.schemas import HardwareInfo

def detect_hardware() -> HardwareInfo:
    cpu_count = os.cpu_count() or 1
    ram_total_mb = 16384
    ram_free_mb = 4096

    # Platform-specific memory detection
    try:
        if sys.platform == "win32":
            import ctypes
            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("sullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]
            stat = MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(stat)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
                ram_total_mb = int(stat.ullTotalPhys / (1024 * 1024))
                ram_free_mb = int(stat.ullAvailPhys / (1024 * 1024))
        else:
            with open("/proc/meminfo", "r") as f:
                meminfo = dict(line.split(":") for line in f if ":" in line)
                ram_total_mb = int(int(meminfo["MemTotal"].strip().split()[0]) / 1024)
                ram_free_mb = int(int(meminfo.get("MemAvailable", meminfo["MemFree"]).strip().split()[0]) / 1024)
    except Exception:
        pass

    cuda_available = False
    gpu_name: Optional[str] = None
    vram_total_mb: Optional[int] = None
    vram_free_mb: Optional[int] = None

    try:
        import torch
        if torch.cuda.is_available():
            cuda_available = True
            gpu_name = torch.cuda.get_device_name(0)
            props = torch.cuda.get_device_properties(0)
            vram_total_mb = int(props.total_memory / (1024 * 1024))
            vram_free_mb = int(torch.cuda.mem_get_info()[0] / (1024 * 1024))
    except Exception:
        pass

    device = "cuda" if cuda_available else "cpu"

    return HardwareInfo(
        cpu_count=cpu_count,
        ram_total_mb=ram_total_mb,
        ram_free_mb=ram_free_mb,
        cuda_available=cuda_available,
        gpu_name=gpu_name,
        vram_total_mb=vram_total_mb,
        vram_free_mb=vram_free_mb,
        device=device,
    )
