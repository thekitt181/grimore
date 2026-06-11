"""Optional FastAPI server for separate Render deploy (FLOORPLAN_SCAN_URL)."""

from __future__ import annotations

import base64
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from floorplan_scan.png_scan import PngFloorplanScanner


class ScanRequest(BaseModel):
    imageBase64: str
    width: int = Field(ge=8)
    height: int = Field(ge=8)
    gridSize: int = Field(ge=4, default=70)
    gridOffsetX: int = 0
    gridOffsetY: int = 0


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.scanner = PngFloorplanScanner(
        device=os.environ.get("FLOORPLAN_DEVICE", "auto"),
    )
    yield


app = FastAPI(title="Grimoire floorplan scan", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
def healthz() -> dict:
    scanner: PngFloorplanScanner = app.state.scanner
    return {"ok": True, "device": str(scanner.device), "epoch": scanner.epoch}


@app.post("/scan")
def scan(req: ScanRequest) -> dict:
    try:
        png_bytes = base64.b64decode(req.imageBase64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"invalid base64: {e}") from e
    if not png_bytes:
        raise HTTPException(status_code=400, detail="empty image")

    scanner: PngFloorplanScanner = app.state.scanner
    try:
        return scanner.scan_grid(
            png_bytes,
            req.width,
            req.height,
            req.gridSize,
            req.gridOffsetX,
            req.gridOffsetY,
        )
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
