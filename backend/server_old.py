from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Depends, Request, Response
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import io
import csv
import logging
import bcrypt
import jwt
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Any, Dict
import uuid
from datetime import datetime, timezone, timedelta

from database import init_db


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Garment Manufacturing ERP")
api_router = APIRouter(prefix="/api")


@app.on_event("startup")
def startup_event() -> None:
    init_db()


# ============ Utilities ============
def now_iso():
    return datetime.now(timezone.utc).isoformat()


def uid():
    return str(uuid.uuid4())


PRODUCTION_STAGES = [
    "order_received", "sampling", "buyer_approval", "fabric_purchase",
    "fabric_received", "cutting", "printing", "stitching", "washing",
    "finishing", "quality_check", "packing", "warehouse", "shipment"
]


# ============ AUTH ============
JWT_ALGO = "HS256"
JWT_EXPIRY_DAYS = 30


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_token(username: str) -> str:
    payload = {
        "sub": username,
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRY_DAYS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, os.environ["JWT_SECRET"], algorithm=JWT_ALGO)


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("FABRITRACK_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, os.environ["JWT_SECRET"], algorithms=[JWT_ALGO])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"username": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


COOKIE_NAME = "FABRITRACK_token"
COOKIE_MAX_AGE = JWT_EXPIRY_DAYS * 24 * 60 * 60


def set_auth_cookie(response, token: str) -> None:
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        secure=True,
        samesite="lax",
        path="/",
    )


def clear_auth_cookie(response) -> None:
    response.delete_cookie(
        key=COOKIE_NAME,
        path="/",
        httponly=True,
        secure=True,
        samesite="lax",
    )


class LoginPayload(BaseModel):
    username: str
    password: str


class ChangePasswordPayload(BaseModel):
    current_password: str
    new_password: str


class ChangeUsernamePayload(BaseModel):
    current_password: str
    new_username: str


# ============ APP SETTINGS ============
class AppSettings(BaseModel):
    app_name: str = "FABRITRACK"
    tagline: str = "Manufacturing ERP"


class AppSettingsUpdate(BaseModel):
    app_name: Optional[str] = None
    tagline: Optional[str] = None


# ============ Models ============
class Buyer(BaseModel):
    id: str = Field(default_factory=uid)
    name: str
    contact: Optional[str] = ""
    country: Optional[str] = ""
    type: Literal["local", "export"] = "local"
    archived: bool = False
    created_at: str = Field(default_factory=now_iso)


class BuyerCreate(BaseModel):
    name: str
    contact: Optional[str] = ""
    country: Optional[str] = ""
    type: Literal["local", "export"] = "local"


class ProductType(BaseModel):
    id: str = Field(default_factory=uid)
    name: str
    avg_fabric_per_piece_kg: float = 0.25
    description: Optional[str] = ""
    archived: bool = False
    created_at: str = Field(default_factory=now_iso)


class ProductTypeCreate(BaseModel):
    name: str
    avg_fabric_per_piece_kg: float = 0.25
    description: Optional[str] = ""


class Vendor(BaseModel):
    id: str = Field(default_factory=uid)
    name: str
    type: Literal["own", "third_party"] = "third_party"
    contact: Optional[str] = ""
    location: Optional[str] = ""
    archived: bool = False
    created_at: str = Field(default_factory=now_iso)


class VendorCreate(BaseModel):
    name: str
    type: Literal["own", "third_party"] = "third_party"
    contact: Optional[str] = ""
    location: Optional[str] = ""


class FabricLot(BaseModel):
    id: str = Field(default_factory=uid)
    fabric_type: str
    color: Optional[str] = ""
    supplier: Optional[str] = ""
    kg_received: float
    cost_per_kg: float = 0.0
    date_received: str = Field(default_factory=now_iso)
    notes: Optional[str] = ""
    archived: bool = False
    created_at: str = Field(default_factory=now_iso)


class FabricLotCreate(BaseModel):
    fabric_type: str
    color: Optional[str] = ""
    supplier: Optional[str] = ""
    kg_received: float
    cost_per_kg: float = 0.0
    date_received: Optional[str] = None
    notes: Optional[str] = ""


class FabricDispatch(BaseModel):
    id: str = Field(default_factory=uid)
    fabric_lot_id: str
    vendor_id: str
    order_id: Optional[str] = None
    product_type_id: Optional[str] = None
    kg_dispatched: float
    date: str = Field(default_factory=now_iso)
    notes: Optional[str] = ""
    archived: bool = False
    created_at: str = Field(default_factory=now_iso)


class FabricDispatchCreate(BaseModel):
    fabric_lot_id: str
    vendor_id: str
    order_id: Optional[str] = None
    product_type_id: Optional[str] = None
    kg_dispatched: float
    date: Optional[str] = None
    notes: Optional[str] = ""


class Order(BaseModel):
    id: str = Field(default_factory=uid)
    order_number: str
    buyer_id: str
    product_type_id: str
    quantity: int
    unit_price: float = 0.0
    stage: str = "order_received"
    order_date: str = Field(default_factory=now_iso)
    delivery_date: Optional[str] = None
    notes: Optional[str] = ""
    archived: bool = False
    created_at: str = Field(default_factory=now_iso)


class OrderCreate(BaseModel):
    order_number: str
    buyer_id: str
    product_type_id: str
    quantity: int
    unit_price: float = 0.0
    stage: str = "order_received"
    order_date: Optional[str] = None
    delivery_date: Optional[str] = None
    notes: Optional[str] = ""


class OrderStageUpdate(BaseModel):
    stage: str


class ProductionReturn(BaseModel):
    id: str = Field(default_factory=uid)
    vendor_id: str
    order_id: Optional[str] = None
    product_type_id: str
    pieces_received: int
    pieces_defected: int = 0
    kg_used: float = 0.0
    fabric_returned_kg: float = 0.0
    cutting_waste_kg: float = 0.0
    job_work_rate_per_piece: float = 0.0
    date: str = Field(default_factory=now_iso)
    notes: Optional[str] = ""
    archived: bool = False
    created_at: str = Field(default_factory=now_iso)


class ProductionReturnCreate(BaseModel):
    vendor_id: str
    order_id: Optional[str] = None
    product_type_id: str
    pieces_received: int
    pieces_defected: int = 0
    kg_used: float = 0.0
    fabric_returned_kg: float = 0.0
    cutting_waste_kg: float = 0.0
    job_work_rate_per_piece: float = 0.0
    date: Optional[str] = None
    notes: Optional[str] = ""


# ============ Helpers ============
async def _list(collection, include_archived: bool = False):
    q = {} if include_archived else {"archived": {"$ne": True}}
    return await collection.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)


async def _get(collection, item_id):
    doc = await collection.find_one({"id": item_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    return doc


async def _update(collection, item_id: str, updates: Dict[str, Any], allowed_fields: List[str]):
    clean = {k: v for k, v in updates.items() if k in allowed_fields and v is not None}
    if not clean:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    result = await collection.update_one({"id": item_id}, {"$set": clean})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return await _get(collection, item_id)


class ArchivePayload(BaseModel):
    archived: bool = True


# ============ BUYERS ============
@api_router.get("/buyers", response_model=List[Buyer])
async def list_buyers(include_archived: bool = False):
    return await _list(db.buyers, include_archived)


@api_router.post("/buyers", response_model=Buyer)
async def create_buyer(payload: BuyerCreate):
    obj = Buyer(**payload.model_dump())
    await db.buyers.insert_one(obj.model_dump())
    return obj


@api_router.patch("/buyers/{item_id}", response_model=Buyer)
async def update_buyer(item_id: str, updates: Dict[str, Any]):
    return await _update(db.buyers, item_id, updates, ["name", "contact", "country", "type"])


@api_router.patch("/buyers/{item_id}/archive")
async def archive_buyer(item_id: str, payload: ArchivePayload):
    return await _update(db.buyers, item_id, {"archived": payload.archived}, ["archived"])


@api_router.delete("/buyers/{item_id}")
async def delete_buyer(item_id: str):
    await db.buyers.delete_one({"id": item_id})
    return {"ok": True}


# ============ PRODUCT TYPES ============
@api_router.get("/product-types", response_model=List[ProductType])
async def list_product_types(include_archived: bool = False):
    return await _list(db.product_types, include_archived)


@api_router.post("/product-types", response_model=ProductType)
async def create_product_type(payload: ProductTypeCreate):
    obj = ProductType(**payload.model_dump())
    await db.product_types.insert_one(obj.model_dump())
    return obj


@api_router.patch("/product-types/{item_id}", response_model=ProductType)
async def update_product_type(item_id: str, updates: Dict[str, Any]):
    return await _update(db.product_types, item_id, updates, ["name", "avg_fabric_per_piece_kg", "description"])


@api_router.patch("/product-types/{item_id}/archive")
async def archive_product_type(item_id: str, payload: ArchivePayload):
    return await _update(db.product_types, item_id, {"archived": payload.archived}, ["archived"])


@api_router.delete("/product-types/{item_id}")
async def delete_product_type(item_id: str):
    await db.product_types.delete_one({"id": item_id})
    return {"ok": True}


# ============ VENDORS ============
@api_router.get("/vendors", response_model=List[Vendor])
async def list_vendors(include_archived: bool = False):
    return await _list(db.vendors, include_archived)


@api_router.post("/vendors", response_model=Vendor)
async def create_vendor(payload: VendorCreate):
    obj = Vendor(**payload.model_dump())
    await db.vendors.insert_one(obj.model_dump())
    return obj


@api_router.patch("/vendors/{item_id}", response_model=Vendor)
async def update_vendor(item_id: str, updates: Dict[str, Any]):
    return await _update(db.vendors, item_id, updates, ["name", "type", "contact", "location"])


@api_router.patch("/vendors/{item_id}/archive")
async def archive_vendor(item_id: str, payload: ArchivePayload):
    return await _update(db.vendors, item_id, {"archived": payload.archived}, ["archived"])


@api_router.delete("/vendors/{item_id}")
async def delete_vendor(item_id: str):
    await db.vendors.delete_one({"id": item_id})
    return {"ok": True}


# ============ FABRIC LOTS ============
@api_router.get("/fabric-lots")
async def list_fabric_lots(include_archived: bool = False):
    lots = await _list(db.fabric_lots, include_archived)
    if not lots:
        return lots
    # Batch aggregate: sum kg_dispatched grouped by fabric_lot_id in a single query
    lot_ids = [l["id"] for l in lots]
    pipeline = [
        {"$match": {"fabric_lot_id": {"$in": lot_ids}, "archived": {"$ne": True}}},
        {"$group": {"_id": "$fabric_lot_id", "total": {"$sum": "$kg_dispatched"}}},
    ]
    totals = {
        d["_id"]: d["total"]
        async for d in db.fabric_dispatches.aggregate(pipeline)
    }
    for lot in lots:
        total_dispatched = totals.get(lot["id"], 0.0)
        lot["kg_dispatched"] = round(total_dispatched, 3)
        lot["kg_remaining"] = round(lot["kg_received"] - total_dispatched, 3)
    return lots


@api_router.post("/fabric-lots", response_model=FabricLot)
async def create_fabric_lot(payload: FabricLotCreate):
    data = payload.model_dump()
    if not data.get("date_received"):
        data["date_received"] = now_iso()
    obj = FabricLot(**data)
    await db.fabric_lots.insert_one(obj.model_dump())
    return obj


@api_router.patch("/fabric-lots/{item_id}", response_model=FabricLot)
async def update_fabric_lot(item_id: str, updates: Dict[str, Any]):
    return await _update(db.fabric_lots, item_id, updates,
                         ["fabric_type", "color", "supplier", "kg_received", "cost_per_kg", "date_received", "notes"])


@api_router.patch("/fabric-lots/{item_id}/archive")
async def archive_fabric_lot(item_id: str, payload: ArchivePayload):
    return await _update(db.fabric_lots, item_id, {"archived": payload.archived}, ["archived"])


@api_router.delete("/fabric-lots/{item_id}")
async def delete_fabric_lot(item_id: str):
    await db.fabric_lots.delete_one({"id": item_id})
    return {"ok": True}


# ============ FABRIC DISPATCHES ============
@api_router.get("/fabric-dispatches", response_model=List[FabricDispatch])
async def list_fabric_dispatches(include_archived: bool = False):
    return await _list(db.fabric_dispatches, include_archived)


@api_router.post("/fabric-dispatches", response_model=FabricDispatch)
async def create_fabric_dispatch(payload: FabricDispatchCreate):
    lot = await _get(db.fabric_lots, payload.fabric_lot_id)
    dispatched = await db.fabric_dispatches.aggregate([
        {"$match": {"fabric_lot_id": lot["id"], "archived": {"$ne": True}}},
        {"$group": {"_id": None, "total": {"$sum": "$kg_dispatched"}}}
    ]).to_list(1)
    total_dispatched = dispatched[0]["total"] if dispatched else 0.0
    remaining = lot["kg_received"] - total_dispatched
    if payload.kg_dispatched > remaining + 0.001:
        raise HTTPException(status_code=400,
                            detail=f"Only {remaining:.3f} kg remaining in this lot")
    data = payload.model_dump()
    if not data.get("date"):
        data["date"] = now_iso()
    obj = FabricDispatch(**data)
    await db.fabric_dispatches.insert_one(obj.model_dump())
    return obj


@api_router.patch("/fabric-dispatches/{item_id}", response_model=FabricDispatch)
async def update_fabric_dispatch(item_id: str, updates: Dict[str, Any]):
    return await _update(db.fabric_dispatches, item_id, updates,
                         ["fabric_lot_id", "vendor_id", "order_id", "product_type_id", "kg_dispatched", "date", "notes"])


@api_router.patch("/fabric-dispatches/{item_id}/archive")
async def archive_fabric_dispatch(item_id: str, payload: ArchivePayload):
    return await _update(db.fabric_dispatches, item_id, {"archived": payload.archived}, ["archived"])


@api_router.delete("/fabric-dispatches/{item_id}")
async def delete_fabric_dispatch(item_id: str):
    await db.fabric_dispatches.delete_one({"id": item_id})
    return {"ok": True}


# ============ ORDERS ============
@api_router.get("/orders", response_model=List[Order])
async def list_orders(include_archived: bool = False):
    return await _list(db.orders, include_archived)


@api_router.get("/orders/stages")
async def get_stages():
    return {"stages": PRODUCTION_STAGES}


@api_router.post("/orders", response_model=Order)
async def create_order(payload: OrderCreate):
    data = payload.model_dump()
    if not data.get("order_date"):
        data["order_date"] = now_iso()
    obj = Order(**data)
    await db.orders.insert_one(obj.model_dump())
    return obj


@api_router.patch("/orders/{item_id}", response_model=Order)
async def update_order(item_id: str, updates: Dict[str, Any]):
    return await _update(db.orders, item_id, updates,
                         ["order_number", "buyer_id", "product_type_id", "quantity", "unit_price",
                          "stage", "order_date", "delivery_date", "notes"])


@api_router.patch("/orders/{item_id}/archive")
async def archive_order(item_id: str, payload: ArchivePayload):
    return await _update(db.orders, item_id, {"archived": payload.archived}, ["archived"])


@api_router.patch("/orders/{item_id}/stage", response_model=Order)
async def update_order_stage(item_id: str, payload: OrderStageUpdate):
    if payload.stage not in PRODUCTION_STAGES:
        raise HTTPException(status_code=400, detail="Invalid stage")
    await db.orders.update_one({"id": item_id}, {"$set": {"stage": payload.stage}})
    doc = await _get(db.orders, item_id)
    return doc


@api_router.delete("/orders/{item_id}")
async def delete_order(item_id: str):
    await db.orders.delete_one({"id": item_id})
    return {"ok": True}


# ============ PRODUCTION RETURNS ============
@api_router.get("/production-returns", response_model=List[ProductionReturn])
async def list_production_returns(include_archived: bool = False):
    return await _list(db.production_returns, include_archived)


@api_router.post("/production-returns", response_model=ProductionReturn)
async def create_production_return(payload: ProductionReturnCreate):
    data = payload.model_dump()
    if not data.get("date"):
        data["date"] = now_iso()
    obj = ProductionReturn(**data)
    await db.production_returns.insert_one(obj.model_dump())
    return obj


@api_router.patch("/production-returns/{item_id}", response_model=ProductionReturn)
async def update_production_return(item_id: str, updates: Dict[str, Any]):
    return await _update(db.production_returns, item_id, updates,
                         ["vendor_id", "order_id", "product_type_id", "pieces_received", "pieces_defected",
                          "kg_used", "fabric_returned_kg", "cutting_waste_kg", "job_work_rate_per_piece",
                          "date", "notes"])


@api_router.patch("/production-returns/{item_id}/archive")
async def archive_production_return(item_id: str, payload: ArchivePayload):
    return await _update(db.production_returns, item_id, {"archived": payload.archived}, ["archived"])


@api_router.delete("/production-returns/{item_id}")
async def delete_production_return(item_id: str):
    await db.production_returns.delete_one({"id": item_id})
    return {"ok": True}


# ============ DASHBOARD HELPERS ============
def _parse_iso(iso):
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except Exception:
        return None


async def _load_active(collection_names: List[str]) -> Dict[str, list]:
    """Load all non-archived docs for the given collections."""
    q = {"archived": {"$ne": True}}
    out: Dict[str, list] = {}
    for name in collection_names:
        out[name] = await db[name].find(q, {"_id": 0}).to_list(5000)
    return out


def _fabric_totals(lots: list, dispatches: list, returns: list) -> dict:
    received = sum(l["kg_received"] for l in lots)
    dispatched = sum(d["kg_dispatched"] for d in dispatches)
    used = sum(r["kg_used"] for r in returns)
    pieces = sum(r["pieces_received"] for r in returns)
    defected = sum(r["pieces_defected"] for r in returns)
    return {
        "total_kg_received": round(received, 3),
        "total_kg_dispatched": round(dispatched, 3),
        "total_kg_remaining": round(received - dispatched, 3),
        "total_kg_used": round(used, 3),
        "total_pieces_received": pieces,
        "total_pieces_defected": defected,
        "avg_fabric_per_piece_kg": round(used / pieces, 4) if pieces else 0.0,
        "defect_rate_pct": round((defected / pieces) * 100, 2) if pieces else 0.0,
    }


def _vendor_stats(dispatches: list, returns: list, vendors: list) -> list:
    vendor_map = {v["id"]: v["name"] for v in vendors}
    stats: Dict[str, dict] = {}

    def bucket(vid: str) -> dict:
        return stats.setdefault(vid, {
            "vendor": vendor_map.get(vid, "Unknown"),
            "kg_dispatched": 0.0, "pieces_received": 0, "pieces_defected": 0,
        })

    for d in dispatches:
        bucket(d["vendor_id"])["kg_dispatched"] += d["kg_dispatched"]
    for r in returns:
        b = bucket(r["vendor_id"])
        b["pieces_received"] += r["pieces_received"]
        b["pieces_defected"] += r["pieces_defected"]
    for s in stats.values():
        s["kg_dispatched"] = round(s["kg_dispatched"], 3)
    return list(stats.values())


def _fabric_by_type(lots: list) -> list:
    totals: Dict[str, float] = {}
    for l in lots:
        totals[l["fabric_type"]] = totals.get(l["fabric_type"], 0.0) + l["kg_received"]
    return [{"fabric_type": k, "kg": round(v, 3)} for k, v in totals.items()]


def _product_stats(returns: list, product_types: list) -> list:
    pt_map = {p["id"]: p["name"] for p in product_types}
    stats: Dict[str, dict] = {}
    for r in returns:
        pid = r["product_type_id"]
        s = stats.setdefault(pid, {
            "product": pt_map.get(pid, "Unknown"),
            "pieces_received": 0, "pieces_defected": 0, "kg_used": 0.0,
        })
        s["pieces_received"] += r["pieces_received"]
        s["pieces_defected"] += r["pieces_defected"]
        s["kg_used"] += r["kg_used"]
    for s in stats.values():
        s["kg_used"] = round(s["kg_used"], 3)
    return list(stats.values())


def _stage_funnel(orders: list) -> list:
    counts = {s: 0 for s in PRODUCTION_STAGES}
    for o in orders:
        if o["stage"] in counts:
            counts[o["stage"]] += 1
    return [{"stage": s, "count": counts[s]} for s in PRODUCTION_STAGES]


@api_router.get("/dashboard/summary")
async def dashboard_summary():
    data = await _load_active([
        "fabric_lots", "fabric_dispatches", "production_returns",
        "orders", "vendors", "product_types",
    ])
    fabric = _fabric_totals(data["fabric_lots"], data["fabric_dispatches"], data["production_returns"])
    return {
        "kpi": {
            **fabric,
            "total_orders": len(data["orders"]),
            "total_vendors": len(data["vendors"]),
        },
        "vendor_stats": _vendor_stats(data["fabric_dispatches"], data["production_returns"], data["vendors"]),
        "fabric_by_type": _fabric_by_type(data["fabric_lots"]),
        "product_stats": _product_stats(data["production_returns"], data["product_types"]),
        "stage_funnel": _stage_funnel(data["orders"]),
    }


@api_router.get("/")
async def root():
    return {"message": "Garment ERP API", "status": "ok"}


# ============ AUTH ENDPOINTS ============
@api_router.post("/auth/login")
async def login(payload: LoginPayload, response: Response):
    user = await db.users.find_one({"username": payload.username.strip()}, {"_id": 0})
    if not user or not verify_password(payload.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = create_token(user["username"])
    set_auth_cookie(response, token)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"username": user["username"]},
    }


@api_router.post("/auth/logout")
async def logout(response: Response):
    clear_auth_cookie(response)
    return {"ok": True}


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {"username": user["username"]}


@api_router.post("/auth/change-password")
async def change_password(payload: ChangePasswordPayload, user: dict = Depends(get_current_user)):
    existing = await db.users.find_one({"username": user["username"]}, {"_id": 0})
    if not verify_password(payload.current_password, existing.get("password_hash", "")):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(payload.new_password) < 4:
        raise HTTPException(status_code=400, detail="New password must be at least 4 characters")
    await db.users.update_one(
        {"username": user["username"]},
        {"$set": {"password_hash": hash_password(payload.new_password)}},
    )
    return {"ok": True}


@api_router.post("/auth/change-username")
async def change_username(
    payload: ChangeUsernamePayload,
    response: Response,
    user: dict = Depends(get_current_user),
):
    existing = await db.users.find_one({"username": user["username"]}, {"_id": 0})
    if not verify_password(payload.current_password, existing.get("password_hash", "")):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    new_u = payload.new_username.strip()
    if not new_u:
        raise HTTPException(status_code=400, detail="Username cannot be empty")
    if new_u != user["username"]:
        clash = await db.users.find_one({"username": new_u})
        if clash:
            raise HTTPException(status_code=400, detail="Username already taken")
    await db.users.update_one(
        {"username": user["username"]},
        {"$set": {"username": new_u}},
    )
    token = create_token(new_u)
    set_auth_cookie(response, token)
    return {"ok": True, "access_token": token, "user": {"username": new_u}}


# ============ APP SETTINGS ============
async def _get_settings() -> dict:
    doc = await db.app_settings.find_one({"key": "app"}, {"_id": 0})
    if not doc:
        default = {"key": "app", "app_name": "FABRITRACK", "tagline": "Manufacturing ERP"}
        await db.app_settings.insert_one(default)
        doc = default
    return {"app_name": doc.get("app_name", "FABRITRACK"), "tagline": doc.get("tagline", "Manufacturing ERP")}


@api_router.get("/settings")
async def get_settings():
    return await _get_settings()


@api_router.patch("/settings")
async def update_settings(payload: AppSettingsUpdate, user: dict = Depends(get_current_user)):
    updates = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    await db.app_settings.update_one(
        {"key": "app"}, {"$set": updates}, upsert=True,
    )
    return await _get_settings()


# ============ DASHBOARD - EXTENDED KPIS ============
def _todays_activity(lots: list, dispatches: list, returns: list, today) -> dict:
    def on_today(iso):
        d = _parse_iso(iso)
        return d is not None and d.date() == today

    production = sum(r["pieces_received"] for r in returns if on_today(r.get("date")))
    dispatch_kg = sum(d["kg_dispatched"] for d in dispatches if on_today(d.get("date")))
    receipt_kg = sum(l["kg_received"] for l in lots if on_today(l.get("date_received")))
    return {
        "todays_production_pieces": production,
        "todays_dispatch_kg": round(dispatch_kg, 3),
        "todays_receipt_kg": round(receipt_kg, 3),
    }


def _order_status(orders: list, today) -> dict:
    pending = sum(1 for o in orders if o["stage"] != "shipment")
    delayed = 0
    for o in orders:
        if o["stage"] == "shipment":
            continue
        dd = _parse_iso(o.get("delivery_date"))
        if dd and dd.date() < today:
            delayed += 1
    return {"pending_orders": pending, "delayed_orders": delayed}


def _fabric_location(lots: list, dispatches: list, returns: list, vendors: list) -> dict:
    total_recv = sum(l["kg_received"] for l in lots)
    total_disp = sum(d["kg_dispatched"] for d in dispatches)
    tp_ids = {v["id"] for v in vendors if v.get("type") == "third_party"}
    disp_to_tp = sum(d["kg_dispatched"] for d in dispatches if d["vendor_id"] in tp_ids)
    accounted_tp = sum(
        r.get("kg_used", 0) + r.get("fabric_returned_kg", 0) + r.get("cutting_waste_kg", 0)
        for r in returns if r["vendor_id"] in tp_ids
    )
    return {
        "fabric_available_kg": round(total_recv - total_disp, 3),
        "fabric_at_third_party_kg": round(max(disp_to_tp - accounted_tp, 0), 3),
    }


def _quality_metrics(returns: list) -> dict:
    total = sum(r["pieces_received"] for r in returns)
    defected = sum(r["pieces_defected"] for r in returns)
    defect_pct = round((defected / total) * 100, 2) if total else 0.0
    return {
        "defect_pct": defect_pct,
        "efficiency_pct": round(100 - defect_pct, 2) if total else 0.0,
    }


def _monthly_revenue(orders: list, buyers: list, month_start) -> dict:
    buyer_type = {b["id"]: b.get("type", "local") for b in buyers}
    sales = export_sales = 0.0
    for o in orders:
        od = _parse_iso(o.get("order_date"))
        if not od or od < month_start:
            continue
        revenue = (o.get("unit_price", 0.0) or 0.0) * o.get("quantity", 0)
        sales += revenue
        if buyer_type.get(o["buyer_id"]) == "export":
            export_sales += revenue
    return {
        "sales_this_month": round(sales, 2),
        "export_this_month": round(export_sales, 2),
    }


@api_router.get("/dashboard/extended")
async def dashboard_extended():
    """Today's activity + monthly KPIs + defect/efficiency metrics."""
    data = await _load_active([
        "fabric_lots", "fabric_dispatches", "production_returns",
        "orders", "buyers", "vendors",
    ])
    now = datetime.now(timezone.utc)
    today = now.date()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    warehouse_stock = sum(
        r["pieces_received"] - r["pieces_defected"] for r in data["production_returns"]
    )

    return {
        **_todays_activity(data["fabric_lots"], data["fabric_dispatches"], data["production_returns"], today),
        **_order_status(data["orders"], today),
        "warehouse_stock_pieces": warehouse_stock,
        **_fabric_location(data["fabric_lots"], data["fabric_dispatches"], data["production_returns"], data["vendors"]),
        **_quality_metrics(data["production_returns"]),
        **_monthly_revenue(data["orders"], data["buyers"], month_start),
    }


# ============ VENDOR JOB WORK LEDGER ============
def _ledger_summary(dispatches: list, returns: list) -> dict:
    received = sum(d["kg_dispatched"] for d in dispatches)
    consumed = sum(r.get("kg_used", 0) for r in returns)
    returned = sum(r.get("fabric_returned_kg", 0) for r in returns)
    waste = sum(r.get("cutting_waste_kg", 0) for r in returns)
    pieces = sum(r["pieces_received"] for r in returns)
    defected = sum(r["pieces_defected"] for r in returns)
    return {
        "total_fabric_received_kg": round(received, 3),
        "total_fabric_consumed_kg": round(consumed, 3),
        "total_fabric_returned_kg": round(returned, 3),
        "total_cutting_waste_kg": round(waste, 3),
        "total_pieces_produced": pieces,
        "total_defected_pieces": defected,
        "avg_fabric_per_piece_kg": round(consumed / pieces, 4) if pieces else 0.0,
        "fabric_lying_with_factory_kg": round(
            max(received - consumed - returned - waste, 0), 3
        ),
        "job_work_charges_payable": round(
            sum(r["pieces_received"] * r.get("job_work_rate_per_piece", 0) for r in returns), 2
        ),
    }


async def _pending_pieces(dispatches: list, returns: list) -> int:
    order_ids = list({d["order_id"] for d in dispatches if d.get("order_id")})
    if not order_ids:
        return 0
    # Batch fetch all orders in one query
    orders = await db.orders.find(
        {"id": {"$in": order_ids}}, {"_id": 0, "id": 1, "quantity": 1}
    ).to_list(5000)
    done_by_order: Dict[str, int] = {}
    for r in returns:
        oid = r.get("order_id")
        if oid:
            done_by_order[oid] = done_by_order.get(oid, 0) + r["pieces_received"]
    return sum(max(o.get("quantity", 0) - done_by_order.get(o["id"], 0), 0) for o in orders)


async def _ledger_txns(dispatches: list, returns: list) -> list:
    lot_ids = list({d["fabric_lot_id"] for d in dispatches})
    product_ids = list({r["product_type_id"] for r in returns})
    lots = {l["id"]: l for l in await db.fabric_lots.find(
        {"id": {"$in": lot_ids}}, {"_id": 0}).to_list(5000)}
    products = {p["id"]: p for p in await db.product_types.find(
        {"id": {"$in": product_ids}}, {"_id": 0}).to_list(5000)}

    txns = []
    for d in dispatches:
        lot = lots.get(d["fabric_lot_id"])
        desc = f"Fabric issued: {lot['fabric_type'] if lot else 'Unknown'} ({lot.get('color', '') if lot else ''})"
        txns.append({
            "id": d["id"], "date": d["date"], "type": "dispatch_out",
            "description": desc, "kg": d["kg_dispatched"],
            "pieces": 0, "amount": 0.0, "order_id": d.get("order_id"),
        })
    for r in returns:
        product = products.get(r["product_type_id"])
        amount = r["pieces_received"] * r.get("job_work_rate_per_piece", 0)
        desc = f"Return: {r['pieces_received']} pcs of {product['name'] if product else 'Unknown'} (defected {r['pieces_defected']})"
        txns.append({
            "id": r["id"], "date": r["date"], "type": "production_return",
            "description": desc, "kg": r.get("kg_used", 0),
            "pieces": r["pieces_received"], "amount": round(amount, 2),
            "order_id": r.get("order_id"),
        })
    txns.sort(key=lambda x: x["date"] or "", reverse=True)
    return txns


@api_router.get("/vendors/{vendor_id}/ledger")
async def vendor_ledger(vendor_id: str):
    vendor = await _get(db.vendors, vendor_id)
    q = {"vendor_id": vendor_id, "archived": {"$ne": True}}
    dispatches = await db.fabric_dispatches.find(q, {"_id": 0}).sort("date", -1).to_list(5000)
    returns = await db.production_returns.find(q, {"_id": 0}).sort("date", -1).to_list(5000)

    summary = _ledger_summary(dispatches, returns)
    summary["pieces_pending_return"] = await _pending_pieces(dispatches, returns)
    txns = await _ledger_txns(dispatches, returns)

    return {"vendor": vendor, "summary": summary, "transactions": txns}


# ============ ORDER FABRIC RECONCILIATION ============
def _reconciliation_metrics(dispatches: list, returns: list) -> dict:
    issued = sum(d["kg_dispatched"] for d in dispatches)
    consumed = sum(r.get("kg_used", 0) for r in returns)
    returned_unused = sum(r.get("fabric_returned_kg", 0) for r in returns)
    waste = sum(r.get("cutting_waste_kg", 0) for r in returns)
    pieces = sum(r["pieces_received"] for r in returns)
    defected = sum(r["pieces_defected"] for r in returns)
    accounted = consumed + returned_unused + waste
    return {
        "fabric_issued_kg": round(issued, 3),
        "fabric_consumed_kg": round(consumed, 3),
        "fabric_returned_unused_kg": round(returned_unused, 3),
        "cutting_waste_kg": round(waste, 3),
        "unaccounted_loss_kg": round(max(issued - accounted, 0), 3),
        "finished_pieces": pieces,
        "defected_pieces": defected,
        "avg_kg_per_piece": round(consumed / pieces, 4) if pieces else 0.0,
    }


async def _avg_fabric_cost(dispatches: list) -> float:
    lot_ids = list({d["fabric_lot_id"] for d in dispatches})
    lots = {l["id"]: l for l in await db.fabric_lots.find(
        {"id": {"$in": lot_ids}}, {"_id": 0}).to_list(5000)}
    total_cost = total_kg = 0.0
    for d in dispatches:
        lot = lots.get(d["fabric_lot_id"])
        if lot:
            total_cost += d["kg_dispatched"] * lot.get("cost_per_kg", 0)
            total_kg += d["kg_dispatched"]
    return (total_cost / total_kg) if total_kg else 0.0


def _piece_costing(recon: dict, avg_cost_per_kg: float, returns: list, order: dict) -> dict:
    fabric_cost_used = round(recon["fabric_consumed_kg"] * avg_cost_per_kg, 2)
    job_work_cost = round(
        sum(r["pieces_received"] * r.get("job_work_rate_per_piece", 0) for r in returns), 2
    )
    total_cost = round(fabric_cost_used + job_work_cost, 2)
    pieces = recon["finished_pieces"]
    cost_per_piece = round(total_cost / pieces, 2) if pieces else 0.0
    unit_price = order.get("unit_price", 0) or 0
    return {
        "avg_fabric_cost_per_kg": round(avg_cost_per_kg, 2),
        "fabric_cost_used": fabric_cost_used,
        "job_work_cost": job_work_cost,
        "total_production_cost": total_cost,
        "cost_per_piece": cost_per_piece,
        "unit_price": unit_price,
        "expected_revenue": round(unit_price * order.get("quantity", 0), 2),
        "margin_per_piece": round(unit_price - cost_per_piece, 2) if cost_per_piece else 0.0,
    }


@api_router.get("/orders/{order_id}/reconciliation")
async def order_reconciliation(order_id: str):
    order = await _get(db.orders, order_id)
    q = {"order_id": order_id, "archived": {"$ne": True}}
    dispatches = await db.fabric_dispatches.find(q, {"_id": 0}).to_list(5000)
    returns = await db.production_returns.find(q, {"_id": 0}).to_list(5000)

    recon = _reconciliation_metrics(dispatches, returns)
    avg_cost = await _avg_fabric_cost(dispatches)
    costing = _piece_costing(recon, avg_cost, returns, order)

    return {"order": order, "reconciliation": recon, "costing": costing}


# ============ CSV IMPORT ============
def _read_csv(file_bytes: bytes):
    text = file_bytes.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    return list(reader)


@api_router.post("/import/fabric-lots")
async def import_fabric_lots(file: UploadFile = File(...)):
    """Columns: fabric_type,color,supplier,kg_received,cost_per_kg,date_received,notes"""
    content = await file.read()
    try:
        rows = _read_csv(content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid CSV: {e}")

    created, errors = 0, []
    for i, row in enumerate(rows, start=2):
        try:
            if not row.get("fabric_type") or not row.get("kg_received"):
                errors.append(f"Row {i}: missing fabric_type or kg_received")
                continue
            payload = {
                "fabric_type": row.get("fabric_type", "").strip(),
                "color": row.get("color", "").strip(),
                "supplier": row.get("supplier", "").strip(),
                "kg_received": float(row.get("kg_received", 0)),
                "cost_per_kg": float(row.get("cost_per_kg", 0) or 0),
                "date_received": row.get("date_received", "").strip() or now_iso(),
                "notes": row.get("notes", "").strip(),
            }
            obj = FabricLot(**payload)
            await db.fabric_lots.insert_one(obj.model_dump())
            created += 1
        except Exception as e:
            errors.append(f"Row {i}: {e}")
    return {"created": created, "errors": errors}


@api_router.post("/import/orders")
async def import_orders(file: UploadFile = File(...)):
    """Columns: order_number,buyer_name,product_name,quantity,unit_price,delivery_date,notes
    Uses buyer_name and product_name lookup (creates them if missing).
    """
    content = await file.read()
    try:
        rows = _read_csv(content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid CSV: {e}")

    created, errors = 0, []
    for i, row in enumerate(rows, start=2):
        try:
            order_number = row.get("order_number", "").strip()
            buyer_name = row.get("buyer_name", "").strip()
            product_name = row.get("product_name", "").strip()
            qty = int(row.get("quantity", 0))
            if not order_number or not buyer_name or not product_name or qty <= 0:
                errors.append(f"Row {i}: missing required fields")
                continue

            buyer_doc = await db.buyers.find_one({"name": buyer_name}, {"_id": 0})
            if not buyer_doc:
                buyer_obj = Buyer(name=buyer_name, type="local")
                await db.buyers.insert_one(buyer_obj.model_dump())
                buyer_doc = buyer_obj.model_dump()

            product_doc = await db.product_types.find_one({"name": product_name}, {"_id": 0})
            if not product_doc:
                product_obj = ProductType(name=product_name, avg_fabric_per_piece_kg=0.25)
                await db.product_types.insert_one(product_obj.model_dump())
                product_doc = product_obj.model_dump()

            payload = {
                "order_number": order_number,
                "buyer_id": buyer_doc["id"],
                "product_type_id": product_doc["id"],
                "quantity": qty,
                "unit_price": float(row.get("unit_price", 0) or 0),
                "delivery_date": row.get("delivery_date", "").strip() or None,
                "notes": row.get("notes", "").strip(),
                "order_date": now_iso(),
            }
            obj = Order(**payload)
            await db.orders.insert_one(obj.model_dump())
            created += 1
        except Exception as e:
            errors.append(f"Row {i}: {e}")
    return {"created": created, "errors": errors}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origin_regex=".*",
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


PUBLIC_PATHS = {"/api/", "/api/auth/login", "/api/auth/logout"}


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    method = request.method
    # Bypass: non-API, OPTIONS preflight, public paths, GET /api/settings
    if (
        method == "OPTIONS"
        or not path.startswith("/api/")
        or path in PUBLIC_PATHS
        or (path == "/api/settings" and method == "GET")
    ):
        return await call_next(request)
    # Read token from httpOnly cookie or Authorization header
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        return JSONResponse({"detail": "Not authenticated"}, status_code=401)
    try:
        jwt.decode(token, os.environ["JWT_SECRET"], algorithms=[JWT_ALGO])
    except jwt.ExpiredSignatureError:
        return JSONResponse({"detail": "Token expired"}, status_code=401)
    except jwt.InvalidTokenError:
        return JSONResponse({"detail": "Invalid token"}, status_code=401)
    return await call_next(request)


async def seed_admin():
    username = os.environ.get("ADMIN_USERNAME", "admin")
    password = os.environ.get("ADMIN_PASSWORD", "admin")
    existing = await db.users.find_one({"username": username})
    if not existing:
        await db.users.insert_one({
            "username": username,
            "password_hash": hash_password(password),
            "created_at": now_iso(),
        })
        logger.info(f"Seeded admin user: {username}")
    # Ensure default settings exist
    await _get_settings()


@app.on_event("startup")
async def startup_event():
    pass


@app.on_event("shutdown")
async def shutdown_db_client():
    pass

