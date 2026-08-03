from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Depends, Request, Response
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import io
import csv
import json
import logging
import re
import subprocess
import tempfile
import bcrypt
import jwt
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Any, Dict
import uuid
import contextvars
from datetime import datetime, timezone, timedelta
import asyncio

import uvicorn

from database import SessionLocal, ensure_schema, engine
from models import (
    AppSettingORM,
    BuyerORM,
    CompanyORM,
    FabricDispatchORM,
    FabricLotORM,
    MaterialAdjustmentORM,
    MaterialDispatchORM,
    MaterialInventoryORM,
    OrderItemORM,
    OrderORM,
    PartyLedgerEntryORM,
    PartyORM,
    PayableORM,
    PaymentTransactionORM,
    ProductTypeORM,
    DispatchChallanLinkORM,
    ProductionReturnORM,
    ReceivableORM,
    ShipmentORM,
    ShipmentProductORM,
    UserORM,
    VendorORM,
    now_utc,
)
from ledger_service import build_manufacturing_ledger, build_material_ledger, build_vendor_job_work_ledger


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')


from sqlalchemy import func, inspect, text

_test_company_id_ctx: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("_test_company_id_ctx", default=None)


class SQLAlchemyCursor:
    def __init__(self, model, query_filters: Optional[Dict[str, Any]] = None, projection: Optional[Dict[str, Any]] = None):
        self.model = model
        self.query_filters = query_filters or {}
        self.projection = projection or {}
        self._sort_fields: List[tuple[str, int]] = []

    def sort(self, field: str, direction: int = 1):
        self._sort_fields.append((field, direction))
        return self

    async def collect(self, limit: int = 1000):
        with SessionLocal() as session:
            query = session.query(self.model)
            query = _apply_query_filters(query, self.model, self.query_filters)
            for field, direction in self._sort_fields:
                column = getattr(self.model, field, None)
                if column is None:
                    continue
                query = query.order_by(column.desc() if direction < 0 else column.asc())
            rows = query.limit(limit).all()
            return [_apply_projection(_serialize_row(self.model, row), self.projection) for row in rows]

    def __aiter__(self):
        async def generator():
            rows = await self.collect()
            for item in rows:
                yield item
        return generator()


class SQLAlchemyAggregation:
    def __init__(self, rows):
        self.rows = rows

    async def collect(self, limit: int = 1000):
        return self.rows[:limit]

    def __aiter__(self):
        async def generator():
            for item in self.rows:
                yield item
        return generator()


class SQLAlchemyCollection:
    def __init__(self, model):
        self.model = model

    async def read_one(self, query: Dict[str, Any], projection: Optional[Dict[str, Any]] = None):
        with SessionLocal() as session:
            row = _query_first(session, self.model, query)
            if row is None:
                return None
            return _apply_projection(_serialize_row(self.model, row), projection or {})

    async def create_one(self, doc: Dict[str, Any]):
        with SessionLocal() as session:
            row = _make_row_from_doc(self.model, doc)
            session.add(row)
            session.commit()
            session.refresh(row)
            return _serialize_row(self.model, row)

    async def update_record(self, query: Dict[str, Any], update: Dict[str, Any]):
        with SessionLocal() as session:
            row = _query_first(session, self.model, query)
            if row is None:
                return None
            updates = update.get("$set", update)
            for key, value in updates.items():
                setattr(row, _field_name_for_model(self.model, key), _coerce_value(self.model, key, value))
            session.commit()
            session.refresh(row)
            return _serialize_row(self.model, row)

    async def delete_record(self, query: Dict[str, Any]):
        with SessionLocal() as session:
            row = _query_first(session, self.model, query)
            if row is None:
                return None
            session.delete(row)
            session.commit()
            return {"ok": True}

    def find(self, query: Dict[str, Any], projection: Optional[Dict[str, Any]] = None):
        return SQLAlchemyCursor(self.model, query or {}, projection or {})

    def aggregate_rows(self, pipeline: List[Dict[str, Any]]):
        with SessionLocal() as session:
            match = {}
            group_spec = None
            for step in pipeline:
                if "$match" in step:
                    match = step["$match"]
                elif "$group" in step:
                    group_spec = step["$group"]
            if not group_spec:
                return SQLAlchemyAggregation([])
            if self.model is FabricDispatchORM and group_spec.get("_id") == "$fabric_lot_id" and group_spec.get("total") == {"$sum": "$kg_dispatched"}:
                query = session.query(FabricDispatchORM.fabric_lot_id, func.sum(FabricDispatchORM.kg_dispatched).label("total"))
                for field, value in match.items():
                    if field == "fabric_lot_id" and isinstance(value, dict) and "$in" in value:
                        query = query.filter(FabricDispatchORM.fabric_lot_id.in_(value["$in"]))
                    elif field == "archived" and value == {"$ne": True}:
                        query = query.filter(FabricDispatchORM.archived.is_(False))
                rows = query.group_by(FabricDispatchORM.fabric_lot_id).all()
                return SQLAlchemyAggregation([
                    {"_id": row.fabric_lot_id, "total": float(row.total or 0.0)}
                    for row in rows
                ])
            return SQLAlchemyAggregation([])


class SQLAlchemyDB:
    def __init__(self):
        self.users = SQLAlchemyCollection(UserORM)
        self.parties = SQLAlchemyCollection(PartyORM)
        self.buyers = SQLAlchemyCollection(BuyerORM)
        self.product_types = SQLAlchemyCollection(ProductTypeORM)
        self.vendors = SQLAlchemyCollection(VendorORM)
        self.fabric_lots = SQLAlchemyCollection(FabricLotORM)
        self.fabric_dispatches = SQLAlchemyCollection(FabricDispatchORM)
        self.material_inventory = SQLAlchemyCollection(MaterialInventoryORM)
        self.material_dispatches = SQLAlchemyCollection(MaterialDispatchORM)
        self.material_adjustments = SQLAlchemyCollection(MaterialAdjustmentORM)
        self.orders = SQLAlchemyCollection(OrderORM)
        self.production_returns = SQLAlchemyCollection(ProductionReturnORM)
        self.shipments = SQLAlchemyCollection(ShipmentORM)
        self.shipment_products = SQLAlchemyCollection(ShipmentProductORM)
        self.payables = SQLAlchemyCollection(PayableORM)
        self.receivables = SQLAlchemyCollection(ReceivableORM)
        self.payment_transactions = SQLAlchemyCollection(PaymentTransactionORM)
        self.app_settings = SQLAlchemyCollection(AppSettingORM)

    def __getitem__(self, key: str):
        return self._collection_for_name(key)

    def _collection_for_name(self, name: str):
        model = {
            "users": UserORM,
            "parties": PartyORM,
            "buyers": BuyerORM,
            "product_types": ProductTypeORM,
            "vendors": VendorORM,
            "fabric_lots": FabricLotORM,
            "fabric_dispatches": FabricDispatchORM,
            "material_inventory": MaterialInventoryORM,
            "material_dispatches": MaterialDispatchORM,
            "material_adjustments": MaterialAdjustmentORM,
            "orders": OrderORM,
            "production_returns": ProductionReturnORM,
            "shipments": ShipmentORM,
            "shipment_products": ShipmentProductORM,
            "payables": PayableORM,
            "receivables": ReceivableORM,
            "payment_transactions": PaymentTransactionORM,
            "app_settings": AppSettingORM,
        }.get(name)
        if model is None:
            raise KeyError(name)
        return SQLAlchemyCollection(model)


def _field_name_for_model(model, key: str) -> str:
    if key == "id":
        return "id"
    if key == "archived":
        return "archived"
    return key


def _coerce_value(model, key: str, value: Any) -> Any:
    if value is None:
        return None
    if key in {"created_at", "updated_at", "date_received", "date", "order_date", "delivery_date"}:
        if isinstance(value, datetime):
            return value
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00"))
            except Exception:
                return value
    return value


def _make_row_from_doc(model, doc: Dict[str, Any]):
    payload = {}
    for key, value in doc.items():
        if key == "created_at" and value is None:
            continue
        if key == "updated_at" and value is None:
            continue
        if key in {"created_at", "updated_at", "date_received", "date", "order_date", "delivery_date"}:
            payload[key] = _coerce_value(model, key, value)
        else:
            payload[key] = value
    if model is UserORM:
        if "company_id" not in payload:
            payload["company_id"] = _ensure_default_company_id()
        if "password_hash" not in payload and "password" in payload:
            payload["password_hash"] = payload.pop("password")
        return model(**payload)
    if model is AppSettingORM:
        if "company_id" not in payload:
            payload["company_id"] = _ensure_default_company_id()
        return model(**payload)
    if model is BuyerORM:
        if "company_id" not in payload:
            payload["company_id"] = _ensure_default_company_id()
        return model(**payload)
    if model is PartyORM:
        if "company_id" not in payload:
            payload["company_id"] = _ensure_default_company_id()
        return model(**payload)
    if model is PartyLedgerEntryORM:
        if "company_id" not in payload:
            payload["company_id"] = _ensure_default_company_id()
        return model(**payload)
    if model is ProductTypeORM:
        if "company_id" not in payload:
            payload["company_id"] = _ensure_default_company_id()
        return model(**payload)
    if model is VendorORM:
        if "company_id" not in payload:
            payload["company_id"] = _ensure_default_company_id()
        return model(**payload)
    if model is FabricLotORM:
        if "company_id" not in payload:
            payload["company_id"] = _ensure_default_company_id()
        return model(**payload)
    if model is FabricDispatchORM:
        if "company_id" not in payload:
            payload["company_id"] = _ensure_default_company_id()
        return model(**payload)
    if model is MaterialInventoryORM:
        if "company_id" not in payload:
            payload["company_id"] = _ensure_default_company_id()
        return model(**payload)
    if model is MaterialDispatchORM:
        if "company_id" not in payload:
            payload["company_id"] = _ensure_default_company_id()
        return model(**payload)
    if model is OrderORM:
        if "company_id" not in payload:
            payload["company_id"] = _ensure_default_company_id()
        return model(**payload)
    if model is ProductionReturnORM:
        if "company_id" not in payload:
            payload["company_id"] = _ensure_default_company_id()
        return model(**payload)
    if model is PayableORM:
        if "company_id" not in payload:
            payload["company_id"] = _ensure_default_company_id()
        return model(**payload)
    if model is ReceivableORM:
        if "company_id" not in payload:
            payload["company_id"] = _ensure_default_company_id()
        return model(**payload)
    if model is PaymentTransactionORM:
        if "company_id" not in payload:
            payload["company_id"] = _ensure_default_company_id()
        return model(**payload)
    return model(**payload)


def _ensure_default_company_id() -> str:
    test_company_id = _test_company_id_ctx.get()
    if test_company_id:
        with SessionLocal() as session:
            company = session.query(CompanyORM).filter(CompanyORM.id == test_company_id).first()
            if company is None:
                company = CompanyORM(id=test_company_id, name="Test Company", code=f"test-{uuid.uuid4().hex[:8]}", contact_email="ops@fabrik.com", contact_phone="1234")
                session.add(company)
                session.commit()
                session.refresh(company)
            return company.id

    with SessionLocal() as session:
        company = session.query(CompanyORM).first()
        if company is not None:
            return company.id
        company = CompanyORM(name="FabriTrack", code="FT", contact_email="ops@fabrik.com", contact_phone="1234")
        session.add(company)
        session.commit()
        session.refresh(company)
        return company.id


def set_test_company_id(company_id: Optional[str]) -> None:
    _test_company_id_ctx.set(company_id)


def clear_test_company_id() -> None:
    _test_company_id_ctx.set(None)


def _current_company_id() -> str:
    test_company_id = _test_company_id_ctx.get()
    if test_company_id:
        return test_company_id
    return _ensure_default_company_id()


def _apply_company_scope(query, model):
    if hasattr(model, "company_id"):
        return query.filter(getattr(model, "company_id") == _current_company_id())
    return query


def _query_first(session, model, filters: Dict[str, Any]):
    query = session.query(model)
    query = _apply_company_scope(query, model)
    query = _apply_query_filters(query, model, filters or {})
    return query.first()


def _apply_query_filters(query, model, filters: Dict[str, Any]):
    if not filters:
        return query
    for key, value in filters.items():
        if key == "archived":
            query = query.filter(getattr(model, "archived") == value)
        elif key == "$ne":
            continue
        elif key == "id":
            query = query.filter(getattr(model, "id") == value)
        elif key == "username":
            query = query.filter(getattr(model, "username") == value)
        elif key == "name":
            query = query.filter(getattr(model, "name") == value)
        elif key == "key":
            query = query.filter(getattr(model, "key") == value)
        elif key == "fabric_lot_id":
            query = query.filter(getattr(model, "fabric_lot_id") == value)
        elif key == "vendor_id":
            query = query.filter(getattr(model, "vendor_id") == value)
        elif key == "order_id":
            query = query.filter(getattr(model, "order_id") == value)
        elif key == "product_type_id":
            query = query.filter(getattr(model, "product_type_id") == value)
        elif key == "stage":
            query = query.filter(getattr(model, "stage") == value)
        else:
            query = query.filter(getattr(model, key) == value)
    return query


def _apply_projection(payload: Dict[str, Any], projection: Dict[str, Any]) -> Dict[str, Any]:
    if not projection:
        return payload
    result = dict(payload)
    for key, value in projection.items():
        if value == 0 and key in result:
            result.pop(key)
    return result


def _coerce_number(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def normalize_and_merge_records(records: List[Dict[str, Any]], *, key_field: str = "id", value_field: str = "value") -> Dict[Any, Any]:
    """Normalize records and keep the latest non-empty value for each key."""
    merged: Dict[Any, Any] = {}

    for row in records or []:
        if not isinstance(row, dict):
            continue

        key = row.get(key_field)
        if key in (None, ""):
            continue

        current = row.get(value_field)
        if current is None:
            continue

        if isinstance(current, str):
            current = current.strip()

        if current in (None, "", [], {}, set()):
            continue

        merged[key] = current

    return merged


def _normalize_dispatch_note_payload(note_text: str) -> Dict[str, Any]:
    if not note_text:
        return {}
    try:
        parsed = json.loads(note_text)
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _update_dispatch_note_payload(note_text: str, **updates: Any) -> str:
    payload = _normalize_dispatch_note_payload(note_text)
    for key, value in updates.items():
        if value is None:
            continue
        payload[key] = value
    return json.dumps(payload)


def _parse_dispatch_note_blob(note_text: str) -> Dict[str, Any]:
    payload = _normalize_dispatch_note_payload(note_text)
    if payload:
        lines = payload.get("lines") if isinstance(payload.get("lines"), list) else []
        first_line = next((line for line in lines if isinstance(line, dict)), {}) if lines else {}
        return {
            "dispatch_no": str(payload.get("dispatchNo") or payload.get("dispatch_no") or "").strip(),
            "challan_no": str(payload.get("challanNo") or payload.get("challan_no") or "").strip(),
            "expected_return": str(payload.get("expectedReturnDate") or payload.get("expected_return") or "").strip(),
            "expected_pieces": str(payload.get("expectedPieces") or payload.get("expected_pieces") or "").strip(),
            "avg_fabric_per_piece": str(payload.get("avgFabricPerPiece") or payload.get("avg_fabric_per_piece") or "").strip(),
            "fabric_name": str(first_line.get("fabricName") or payload.get("fabric_name") or "").strip(),
            "brand_name": str(first_line.get("brandName") or payload.get("brand_name") or "").strip(),
            "product_type_name": str(first_line.get("productType") or payload.get("product_type_name") or "").strip(),
            "quantity": str(first_line.get("quantity") or payload.get("quantity") or "").strip(),
            "unit": str(first_line.get("unit") or payload.get("unit") or "").strip(),
            "rolls": str(first_line.get("rolls") or payload.get("rolls") or "").strip(),
            "lines": lines,
        }

    text = note_text or ""
    parts = [part.strip() for part in text.split("|") if part.strip()]
    out = {
        "dispatch_no": "",
        "challan_no": "",
        "expected_return": "",
        "expected_pieces": "",
        "avg_fabric_per_piece": "",
        "fabric_name": "",
        "brand_name": "",
        "product_type_name": "",
        "quantity": "",
        "unit": "",
        "rolls": "",
        "lines": [],
    }
    for part in parts:
        if part.startswith("Dispatch No:"):
            out["dispatch_no"] = part.replace("Dispatch No:", "").strip()
        elif part.startswith("Challan:"):
            out["challan_no"] = part.replace("Challan:", "").strip()
        elif part.startswith("Expected Return:"):
            out["expected_return"] = part.replace("Expected Return:", "").strip()
        elif part.startswith("Expected Pieces:"):
            out["expected_pieces"] = part.replace("Expected Pieces:", "").strip()
        elif part.startswith("Avg Fabric / Piece:"):
            out["avg_fabric_per_piece"] = part.replace("Avg Fabric / Piece:", "").strip()
    return out


def _pack_return_notes(*, notes: str = "", challan_no: str = "", lot_no: str = "", article_barcode: str = "", expected_pieces: Optional[float] = None, avg_fabric_per_piece: Optional[float] = None, fabric_still_lying_kg: Optional[float] = None) -> str:
    payload = {
        "meta": {
            "challan_no": challan_no or "",
            "lot_no": lot_no or "",
            "article_barcode": article_barcode or "",
        },
        "notes": notes or "",
        "expected_pieces": None if expected_pieces is None else _coerce_number(expected_pieces, 0.0),
        "avg_fabric_per_piece": None if avg_fabric_per_piece is None else _coerce_number(avg_fabric_per_piece, 0.0),
        "fabric_still_lying_kg": None if fabric_still_lying_kg is None else _coerce_number(fabric_still_lying_kg, 0.0),
    }
    return json.dumps(payload)


def _unpack_return_notes(raw_notes: str) -> Dict[str, Any]:
    if not raw_notes:
        return {
            "notes": "",
            "challan_no": "",
            "lot_no": "",
            "article_barcode": "",
            "expected_pieces": None,
            "avg_fabric_per_piece": None,
            "fabric_still_lying_kg": None,
        }
    try:
        parsed = json.loads(raw_notes)
        if isinstance(parsed, dict):
            meta = parsed.get("meta") or {}
            return {
                "notes": str(parsed.get("notes") or ""),
                "challan_no": str(meta.get("challan_no") or ""),
                "lot_no": str(meta.get("lot_no") or ""),
                "article_barcode": str(meta.get("article_barcode") or ""),
                "expected_pieces": parsed.get("expected_pieces"),
                "avg_fabric_per_piece": parsed.get("avg_fabric_per_piece"),
                "fabric_still_lying_kg": parsed.get("fabric_still_lying_kg"),
            }
    except Exception:
        pass
    return {
        "notes": raw_notes,
        "challan_no": "",
        "lot_no": "",
        "article_barcode": "",
        "expected_pieces": None,
        "avg_fabric_per_piece": None,
        "fabric_still_lying_kg": None,
    }


def _normalize_postgres_url(raw_url: str) -> str:
    if not raw_url:
        return raw_url
    if raw_url.startswith("postgresql+"):
        prefix, rest = raw_url.split("://", 1)
        return f"postgresql://{rest}"
    if raw_url.startswith("postgres://"):
        return raw_url.replace("postgres://", "postgresql://", 1)
    return raw_url


def _serialize_row(model, row):
    if isinstance(row, UserORM):
        return {"id": row.id, "username": row.username, "password_hash": row.password_hash}
    if isinstance(row, PartyORM):
        return {
            "id": row.id,
            "name": row.name,
            "party_type": row.party_type,
            "contact_name": row.contact_name,
            "phone": row.phone,
            "tax_number": row.tax_number,
            "address": row.address,
            "email": row.email,
            "remarks": row.remarks,
            "opening_balance": row.opening_balance,
            "archived": row.archived,
            "created_at": _dt_to_iso(row.created_at),
        }
    if isinstance(row, BuyerORM):
        return {
            "id": row.id,
            "name": row.name,
            "contact": row.contact,
            "country": row.country,
            "type": row.type,
            "archived": row.archived,
            "created_at": _dt_to_iso(row.created_at),
        }
    if isinstance(row, ProductTypeORM):
        return {
            "id": row.id,
            "name": row.name,
            "avg_fabric_per_piece_kg": row.avg_fabric_per_piece_kg,
            "description": row.description,
            "archived": row.archived,
            "created_at": _dt_to_iso(row.created_at),
        }
    if isinstance(row, VendorORM):
        return {
            "id": row.id,
            "name": row.name,
            "type": row.type,
            "contact": row.contact,
            "location": row.location,
            "archived": row.archived,
            "created_at": _dt_to_iso(row.created_at),
        }
    if isinstance(row, FabricLotORM):
        return {
            "id": row.id,
            "fabric_type": row.fabric_type,
            "color": row.color,
            "supplier": row.supplier,
            "kg_received": row.kg_received,
            "cost_per_kg": row.cost_per_kg,
            "date_received": _dt_to_iso(row.date_received),
            "notes": row.notes,
            "archived": row.archived,
            "created_at": _dt_to_iso(row.created_at),
        }
    if isinstance(row, FabricDispatchORM):
        return {
            "id": row.id,
            "fabric_lot_id": row.fabric_lot_id,
            "vendor_id": row.vendor_id,
            "order_id": row.order_id,
            "product_type_id": row.product_type_id,
            "kg_dispatched": row.kg_dispatched,
            "expected_pieces": row.expected_pieces,
            "date": _dt_to_iso(row.date),
            "notes": row.notes,
            "archived": row.archived,
            "created_at": _dt_to_iso(row.created_at),
        }
    if isinstance(row, MaterialInventoryORM):
        return {
            "id": row.id,
            "date": _dt_to_iso(row.date),
            "material_name": row.material_name,
            "supplier": row.supplier,
            "quantity": row.quantity,
            "unit": row.unit,
            "rate": row.rate,
            "amount": row.amount,
            "notes": row.notes,
            "archived": row.archived,
            "created_at": _dt_to_iso(row.created_at),
            "updated_at": _dt_to_iso(row.updated_at),
        }
    if isinstance(row, MaterialDispatchORM):
        allocation_json = row.allocation_json or "[]"
        try:
            allocations = json.loads(allocation_json)
        except Exception:
            allocations = []
        with SessionLocal() as session:
            rate = _material_dispatch_rate(session, allocations)
        amount = round(float(rate or 0.0) * float(row.quantity or 0.0), 2)
        return {
            "id": row.id,
            "date": _dt_to_iso(row.date),
            "dispatch_no": row.dispatch_no,
            "vendor_id": row.vendor_id,
            "material_name": row.material_name,
            "quantity": row.quantity,
            "unit": row.unit,
            "purpose": row.purpose,
            "status": row.status,
            "notes": row.notes,
            "allocations": allocations,
            "rate": rate,
            "amount": amount,
            "archived": row.archived,
            "created_at": _dt_to_iso(row.created_at),
            "updated_at": _dt_to_iso(row.updated_at),
        }
    if isinstance(row, OrderORM):
        return {
            "id": row.id,
            "order_number": row.order_number,
            "buyer_id": row.buyer_id,
            "product_type_id": row.product_type_id,
            "quantity": row.quantity,
            "unit_price": row.unit_price,
            "stage": row.stage,
            "order_date": _dt_to_iso(row.order_date),
            "delivery_date": _dt_to_iso(row.delivery_date),
            "notes": row.notes,
            "archived": row.archived,
            "created_at": _dt_to_iso(row.created_at),
        }
    if isinstance(row, ProductionReturnORM):
        note_data = _unpack_return_notes(row.notes)
        return {
            "id": row.id,
            "dispatch_id": row.order_id,
            "dispatch_no": "",
            "vendor_id": row.vendor_id,
            "vendor_name": "",
            "order_id": row.order_id,
            "product_type_id": row.product_type_id,
            "pieces_received": row.pieces_received,
            "fabric_consumed_kg": row.fabric_consumed_kg,
            "pieces_left": None,
            "pieces_defected": row.pieces_defected,
            "kg_used": row.kg_used,
            "fabric_returned_kg": row.fabric_returned_kg,
            "cutting_waste_kg": row.cutting_waste_kg,
            "expected_pieces": note_data.get("expected_pieces"),
            "avg_fabric_per_piece": note_data.get("avg_fabric_per_piece"),
            "fabric_still_lying_kg": note_data.get("fabric_still_lying_kg"),
            "job_work_rate_per_piece": row.job_work_rate_per_piece,
            "challan_no": note_data["challan_no"],
            "lot_no": note_data["lot_no"],
            "article_barcode": note_data["article_barcode"],
            "date": _dt_to_iso(row.date),
            "notes": row.notes,
            "archived": row.archived,
            "created_at": _dt_to_iso(row.created_at),
        }
    if isinstance(row, ShipmentORM):
        return {
            "id": row.id,
            "shipment_no": row.shipment_no,
            "shipment_date": _dt_to_iso(row.shipment_date),
            "order_id": row.order_id,
            "order_number": row.order_number,
            "customer": row.customer,
            "buyer_name": row.buyer_name,
            "invoice_no": row.invoice_no,
            "transport": row.transport,
            "vehicle_no": row.vehicle_no,
            "lr_no": row.lr_no,
            "destination": row.destination,
            "driver_name": row.driver_name,
            "e_way_bill": row.e_way_bill,
            "remarks": row.remarks,
            "status": row.status,
            "total_dispatch_qty": row.warehouse_available_quantity,
            "archived": row.archived,
            "created_at": _dt_to_iso(row.created_at),
        }
    if isinstance(row, ShipmentProductORM):
        return {
            "id": row.id,
            "order_id": row.order_id,
            "order_number": row.order_number,
            "article_number": row.article_number,
            "brand": row.brand,
            "product_name": row.product_name if hasattr(row, 'product_name') else "",
            "product_type_id": row.product_type_id,
            "product_type_name": row.product_type_name,
            "color": row.color if hasattr(row, 'color') else "",
            "size": row.size,
            "available_pieces": row.available_pieces,
            "dispatch_quantity": row.dispatch_quantity,
            "unit": row.unit,
            "archived": row.archived,
            "created_at": _dt_to_iso(row.created_at),
        }
    if isinstance(row, PayableORM):
        return {
            "id": row.id,
            "vendor": row.vendor,
            "reference_no": row.reference_no,
            "source": row.source,
            "total_amount": row.total_amount,
            "original_job_work_amount": row.original_job_work_amount,
            "paid_amount": row.paid_amount,
            "total_material_adjustment": row.total_material_adjustment,
            "net_payable_amount": row.net_payable_amount,
            "outstanding_balance": row.outstanding_balance,
            "balance_amount": row.balance_amount,
            "due_date": _dt_to_iso(row.due_date),
            "status": row.status,
            "notes": row.notes,
            "archived": row.archived,
            "created_at": _dt_to_iso(row.created_at),
            "updated_at": _dt_to_iso(row.updated_at),
        }
    if isinstance(row, ReceivableORM):
        return {
            "id": row.id,
            "customer": row.customer,
            "invoice_no": row.invoice_no,
            "total_amount": row.total_amount,
            "received_amount": row.received_amount,
            "balance_amount": row.balance_amount,
            "due_date": _dt_to_iso(row.due_date),
            "status": row.status,
            "notes": row.notes,
            "archived": row.archived,
            "created_at": _dt_to_iso(row.created_at),
            "updated_at": _dt_to_iso(row.updated_at),
        }
    if isinstance(row, PaymentTransactionORM):
        return {
            "id": row.id,
            "date": _dt_to_iso(row.date),
            "transaction_type": row.transaction_type,
            "party": row.party,
            "reference_no": row.reference_no,
            "payable_id": row.payable_id,
            "receivable_id": row.receivable_id,
            "amount": row.amount,
            "payment_mode": row.payment_mode,
            "notes": row.notes,
            "archived": row.archived,
            "created_at": _dt_to_iso(row.created_at),
            "updated_at": _dt_to_iso(row.updated_at),
        }
    if isinstance(row, AppSettingORM):
        customization = _parse_customization_payload(getattr(row, "customization_data", "{}"))
        return {"id": row.id, "key": row.key, "app_name": row.app_name, "tagline": row.tagline, "customization_data": json.dumps(customization), "customization": customization}
    return {key: getattr(row, key) for key in row.__dict__ if not key.startswith("_")}


def _dt_to_iso(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


store = SQLAlchemyDB()

app = FastAPI(title="Garment Manufacturing ERP")
api_router = APIRouter(prefix="/api")
_startup_lock = asyncio.Lock()
_startup_complete = False


def _parse_customization_payload(value: Any) -> Dict[str, Any]:
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    if isinstance(value, dict):
        return value
    return {}


def _ensure_customization_column() -> None:
    with engine.begin() as conn:
        inspector = inspect(conn)
        columns = {column["name"] for column in inspector.get_columns("app_settings")}
        if "customization_data" not in columns:
            conn.execute(text("ALTER TABLE app_settings ADD COLUMN customization_data TEXT DEFAULT '{}'"))


@app.on_event("startup")
async def startup_event() -> None:
    global _startup_complete
    if _startup_complete:
        return
    async with _startup_lock:
        if _startup_complete:
            return
        try:
            ensure_schema()
            _ensure_customization_column()
            await seed_admin()
        except Exception:
            logger.exception("Startup initialization failed")
            raise
        _startup_complete = True


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
    with SessionLocal() as session:
        user = session.query(UserORM).filter(UserORM.username == payload["sub"]).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    payload_user = _serialize_row(UserORM, user)
    payload_user.pop("password_hash", None)
    return payload_user


COOKIE_NAME = "FABRITRACK_token"
COOKIE_MAX_AGE = JWT_EXPIRY_DAYS * 24 * 60 * 60


def set_auth_cookie(response, token: str) -> None:
    is_production = os.environ.get("ENV", "").lower() == "production"
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        secure=is_production,
        samesite="lax",
        path="/",
    )


def clear_auth_cookie(response) -> None:
    is_production = os.environ.get("ENV", "").lower() == "production"
    response.delete_cookie(
        key=COOKIE_NAME,
        path="/",
        httponly=True,
        secure=is_production,
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
    customization_data: Optional[Dict[str, Any]] = None


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


class Party(BaseModel):
    id: str = Field(default_factory=uid)
    name: str
    party_type: str
    contact_name: Optional[str] = ""
    phone: Optional[str] = ""
    tax_number: Optional[str] = ""
    address: Optional[str] = ""
    email: Optional[str] = ""
    remarks: Optional[str] = ""
    opening_balance: float = 0.0
    archived: bool = False
    created_at: str = Field(default_factory=now_iso)


class PartyCreate(BaseModel):
    name: str
    party_type: str
    contact_name: Optional[str] = ""
    phone: Optional[str] = ""
    tax_number: Optional[str] = ""
    address: Optional[str] = ""
    email: Optional[str] = ""
    remarks: Optional[str] = ""
    opening_balance: float = 0.0


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
    expected_pieces: float = 0.0
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
    expected_pieces: float = 0.0
    date: Optional[str] = None
    notes: Optional[str] = ""


class MaterialInventory(BaseModel):
    id: str = Field(default_factory=uid)
    date: str = Field(default_factory=now_iso)
    material_name: str
    supplier: str
    quantity: float
    unit: str = "pcs"
    rate: float
    amount: float = 0.0
    notes: Optional[str] = ""
    archived: bool = False
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class MaterialInventoryCreate(BaseModel):
    date: Optional[str] = None
    material_name: str
    supplier: str
    quantity: float
    unit: str = "pcs"
    rate: float
    notes: Optional[str] = ""


class MaterialDispatch(BaseModel):
    id: str = Field(default_factory=uid)
    date: str = Field(default_factory=now_iso)
    dispatch_no: str
    vendor_id: str
    material_name: str
    quantity: float
    unit: str = "pcs"
    purpose: Optional[str] = ""
    status: str = "Dispatched"
    notes: Optional[str] = ""
    allocations: List[Dict[str, Any]] = Field(default_factory=list)
    rate: float = 0.0
    amount: float = 0.0
    archived: bool = False
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class MaterialDispatchCreate(BaseModel):
    date: Optional[str] = None
    dispatch_no: Optional[str] = None
    vendor_id: str
    material_name: str
    quantity: float
    unit: str = "pcs"
    purpose: Optional[str] = ""
    status: Optional[str] = None
    notes: Optional[str] = ""
    rate: Optional[float] = None
    amount: Optional[float] = None


class OrderItem(BaseModel):
    id: Optional[str] = None
    product_type: str = ""
    description: str = ""
    brand: str = ""
    article_number: str = ""
    color: str = ""
    size: str = ""
    fabric: str = ""
    gsm: str = ""
    quantity: int = 0
    unit_price: float = 0.0
    amount: float = 0.0
    remarks: str = ""
    archived: bool = False


class Order(BaseModel):
    id: str = Field(default_factory=uid)
    order_number: str
    buyer_id: str
    product_type_id: Optional[str] = None
    quantity: int = 0
    unit_price: float = 0.0
    stage: str = "order_received"
    order_status: str = "Confirmed"
    order_type: str = "local"
    payment_terms: str = ""
    currency: str = "INR"
    subtotal: float = 0.0
    discount: float = 0.0
    tax: float = 0.0
    grand_total: float = 0.0
    order_date: str = Field(default_factory=now_iso)
    delivery_date: Optional[str] = None
    notes: Optional[str] = ""
    items: List[OrderItem] = []
    total_product_types: int = 0
    total_pieces: int = 0
    archived: bool = False
    created_at: str = Field(default_factory=now_iso)


class OrderCreate(BaseModel):
    order_number: str
    buyer_id: str
    product_type_id: Optional[str] = None
    quantity: int = 0
    unit_price: float = 0.0
    stage: str = "order_received"
    order_status: str = "Confirmed"
    order_type: str = "local"
    payment_terms: str = ""
    currency: str = "INR"
    subtotal: float = 0.0
    discount: float = 0.0
    tax: float = 0.0
    grand_total: float = 0.0
    order_date: Optional[str] = None
    delivery_date: Optional[str] = None
    notes: Optional[str] = ""
    items: List[OrderItem] = []


class OrderStageUpdate(BaseModel):
    stage: str


class ProductionReturn(BaseModel):
    id: str = Field(default_factory=uid)
    dispatch_id: Optional[str] = None
    dispatch_no: Optional[str] = None
    vendor_id: str
    vendor_name: Optional[str] = None
    order_id: Optional[str] = None
    product_type_id: str
    pieces_received: int = 0
    fabric_consumed_kg: float = 0.0
    pieces_left: Optional[float] = None
    pieces_defected: int = 0
    kg_used: float = 0.0
    fabric_returned_kg: float = 0.0
    cutting_waste_kg: float = 0.0
    expected_pieces: Optional[float] = None
    avg_fabric_per_piece: Optional[float] = None
    fabric_still_lying_kg: Optional[float] = None
    job_work_rate_per_piece: float = 0.0
    job_work_rate: Optional[float] = None
    job_work_amount: Optional[float] = None
    challan_no: Optional[str] = ""
    lot_no: Optional[str] = ""
    article_barcode: Optional[str] = ""
    date: str = Field(default_factory=now_iso)
    notes: Optional[str] = ""
    archived: bool = False
    created_at: str = Field(default_factory=now_iso)


class ProductionReturnCreate(BaseModel):
    dispatch_id: str
    vendor_id: Optional[str] = None
    order_id: Optional[str] = None
    product_type_id: Optional[str] = None
    pieces_received: int = 0
    fabric_consumed_kg: float = 0.0
    pieces_defected: int = 0
    kg_used: float = 0.0
    fabric_returned_kg: float = 0.0
    cutting_waste_kg: float = 0.0
    expected_pieces: Optional[float] = None
    avg_fabric_per_piece: Optional[float] = None
    fabric_still_lying_kg: Optional[float] = None
    job_work_rate_per_piece: Optional[float] = None
    job_work_rate: Optional[float] = None
    challan_no: Optional[str] = ""
    lot_no: Optional[str] = ""
    article_barcode: Optional[str] = ""
    date: Optional[str] = None
    notes: Optional[str] = ""


class ShipmentProduct(BaseModel):
    id: str = Field(default_factory=uid)
    order_id: str = ""
    order_number: str = ""
    article_number: str = ""
    brand: str = ""
    product_name: str = ""
    product_type_id: str = ""
    product_type_name: str = ""
    color: str = ""
    size: str = ""
    available_pieces: int = 0
    dispatch_quantity: int = 0
    unit: str = "pcs"
    archived: bool = False
    created_at: str = Field(default_factory=now_iso)


class ShipmentProductCreate(BaseModel):
    order_id: str = ""
    order_number: str = ""
    article_number: str = ""
    brand: str = ""
    product_name: str = ""
    product_type_id: str = ""
    product_type_name: str = ""
    color: str = ""
    size: str = ""
    available_pieces: int = 0
    dispatch_quantity: int = 0
    unit: str = "pcs"


class Shipment(BaseModel):
    id: str = Field(default_factory=uid)
    shipment_no: str
    shipment_date: str = Field(default_factory=now_iso)
    order_id: str = ""
    order_number: str = ""
    customer: str = ""
    buyer_name: str = ""
    invoice_no: str = ""
    transport: str = ""
    vehicle_no: str = ""
    lr_no: str = ""
    destination: str = ""
    driver_name: str = ""
    e_way_bill: str = ""
    remarks: str = ""
    status: str = "Completed"
    total_dispatch_qty: int = 0
    products: List[ShipmentProduct] = Field(default_factory=list)
    archived: bool = False
    created_at: str = Field(default_factory=now_iso)


class ShipmentCreate(BaseModel):
    shipment_no: str = ""
    shipment_date: Optional[str] = None
    order_id: str = ""
    order_number: str = ""
    customer: str = ""
    invoice_no: str = ""
    transport: str = ""
    vehicle_no: str = ""
    lr_no: str = ""
    destination: str = ""
    driver_name: str = ""
    e_way_bill: str = ""
    remarks: str = ""
    products: List[ShipmentProductCreate] = Field(default_factory=list)


class Payable(BaseModel):
    id: str = Field(default_factory=uid)
    vendor: str
    reference_no: str
    source: str = "Fabric Purchase"
    total_amount: float
    original_job_work_amount: float = 0.0
    paid_amount: float = 0.0
    total_material_adjustment: float = 0.0
    net_payable_amount: float = 0.0
    outstanding_balance: float = 0.0
    balance_amount: float = 0.0
    due_date: Optional[str] = None
    status: str = "Pending"
    notes: Optional[str] = ""
    archived: bool = False
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class PayableCreate(BaseModel):
    vendor: str
    reference_no: str
    source: str = "Fabric Purchase"
    total_amount: float
    original_job_work_amount: float = 0.0
    paid_amount: float = 0.0
    total_material_adjustment: float = 0.0
    net_payable_amount: float = 0.0
    outstanding_balance: float = 0.0
    due_date: Optional[str] = None
    notes: Optional[str] = ""


class Receivable(BaseModel):
    id: str = Field(default_factory=uid)
    customer: str
    invoice_no: str
    total_amount: float
    received_amount: float = 0.0
    balance_amount: float = 0.0
    due_date: Optional[str] = None
    status: str = "Pending"
    notes: Optional[str] = ""
    archived: bool = False
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class ReceivableCreate(BaseModel):
    customer: str
    invoice_no: str
    total_amount: float
    received_amount: float = 0.0
    due_date: Optional[str] = None
    notes: Optional[str] = ""


class PaymentTransaction(BaseModel):
    id: str = Field(default_factory=uid)
    date: str = Field(default_factory=now_iso)
    transaction_type: Literal["Payment Given", "Payment Received", "Adjustment"]
    party: str
    reference_no: str = ""
    payable_id: Optional[str] = None
    receivable_id: Optional[str] = None
    amount: float
    payment_mode: Literal["Cash", "Bank", "UPI", "Cheque"] = "Cash"
    notes: Optional[str] = ""
    archived: bool = False
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class PaymentTransactionCreate(BaseModel):
    date: Optional[str] = None
    transaction_type: Literal["Payment Given", "Payment Received", "Adjustment"]
    party: str
    reference_no: str = ""
    payable_id: Optional[str] = None
    receivable_id: Optional[str] = None
    amount: float
    payment_mode: Literal["Cash", "Bank", "UPI", "Cheque"] = "Cash"
    notes: Optional[str] = ""


# ============ Helpers ============
def _resolve_model(collection):
    return getattr(collection, "model", collection)


async def _list(collection, include_archived: bool = False):
    model = _resolve_model(collection)
    with SessionLocal() as session:
        query = session.query(model)
        query = _apply_company_scope(query, model)
        if not include_archived and hasattr(model, "archived"):
            query = query.filter(getattr(model, "archived").isnot(True))
        query = query.order_by(getattr(model, "created_at").desc())
        rows = query.limit(2000).all()
        return [_serialize_row(model, row) for row in rows]


async def _get(collection, item_id):
    model = _resolve_model(collection)
    with SessionLocal() as session:
        query = session.query(model).filter(getattr(model, "id") == item_id)
        query = _apply_company_scope(query, model)
        row = query.first()
        if row is None:
            raise HTTPException(status_code=404, detail="Not found")
        return _serialize_row(model, row)


async def _create(collection, payload: Dict[str, Any]):
    model = _resolve_model(collection)
    with SessionLocal() as session:
        row = _make_row_from_doc(model, payload)
        session.add(row)
        session.commit()
        session.refresh(row)
        return _serialize_row(model, row)


async def _delete(collection, item_id: str):
    model = _resolve_model(collection)
    with SessionLocal() as session:
        query = session.query(model).filter(getattr(model, "id") == item_id)
        query = _apply_company_scope(query, model)
        row = query.first()
        if row is not None:
            session.delete(row)
            session.commit()
    return {"ok": True}


async def _update(collection, item_id: str, updates: Dict[str, Any], allowed_fields: List[str]):
    model = _resolve_model(collection)
    clean = {k: v for k, v in updates.items() if k in allowed_fields and v is not None}
    if not clean:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    with SessionLocal() as session:
        query = session.query(model).filter(getattr(model, "id") == item_id)
        query = _apply_company_scope(query, model)
        row = query.first()
        if row is None:
            raise HTTPException(status_code=404, detail="Not found")
        for key, value in clean.items():
            setattr(row, _field_name_for_model(model, key), _coerce_value(model, key, value))
        session.commit()
        session.refresh(row)
        return _serialize_row(model, row)


class ArchivePayload(BaseModel):
    archived: bool = True


# ============ BUYERS ============
@api_router.get("/parties", response_model=List[Party])
async def list_parties(include_archived: bool = False):
    return await _list(store.parties, include_archived)


@api_router.post("/parties", response_model=Party)
async def create_party(payload: PartyCreate):
    payload_name = (payload.name or "").strip()
    if not payload_name:
        raise HTTPException(status_code=400, detail="Party name is required")
    with SessionLocal() as session:
        existing = session.query(PartyORM).filter(
            PartyORM.company_id == _current_company_id(),
            PartyORM.name == payload_name,
            PartyORM.archived.isnot(True),
        ).first()
        if existing is not None:
            return _serialize_row(PartyORM, existing)
        row = PartyORM(
            company_id=_current_company_id(),
            name=payload_name,
            party_type=(payload.party_type or "Vendor").strip(),
            contact_name=(payload.contact_name or "").strip(),
            phone=(payload.phone or "").strip(),
            tax_number=(payload.tax_number or "").strip(),
            address=(payload.address or "").strip(),
            email=(payload.email or "").strip(),
            remarks=(payload.remarks or "").strip(),
            opening_balance=float(payload.opening_balance or 0.0),
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        if float(row.opening_balance or 0.0) != 0.0:
            _upsert_party_ledger_entry(
                session,
                party=row,
                entry_date=row.created_at or now_utc(),
                module_name="Opening Balance",
                reference_no="OB",
                description="Opening Balance",
                debit=float(row.opening_balance or 0.0) if float(row.opening_balance or 0.0) > 0 else 0.0,
                credit=abs(float(row.opening_balance or 0.0)) if float(row.opening_balance or 0.0) < 0 else 0.0,
                remarks="Opening balance",
                source_type="party",
                source_id=row.id,
                transaction_type="Opening Balance",
            )
            session.commit()
        return _serialize_row(PartyORM, row)


@api_router.patch("/parties/{item_id}", response_model=Party)
async def update_party(item_id: str, updates: Dict[str, Any]):
    with SessionLocal() as session:
        row = session.query(PartyORM).filter(PartyORM.id == item_id, PartyORM.company_id == _current_company_id()).first()
        if row is None:
            raise HTTPException(status_code=404, detail="Party not found")
        for key in ["name", "party_type", "contact_name", "phone", "tax_number", "address", "email", "remarks", "opening_balance"]:
            if key in updates:
                setattr(row, key, updates[key])
        session.commit()
        session.refresh(row)
        return _serialize_row(PartyORM, row)


@api_router.get("/buyers", response_model=List[Buyer])
async def list_buyers(include_archived: bool = False):
    return await _list(store.buyers, include_archived)


@api_router.post("/buyers", response_model=Buyer)
async def create_buyer(payload: BuyerCreate):
    obj = Buyer(**payload.model_dump())
    await _create(store.buyers, obj.model_dump())
    return obj


@api_router.patch("/buyers/{item_id}", response_model=Buyer)
async def update_buyer(item_id: str, updates: Dict[str, Any]):
    return await _update(store.buyers, item_id, updates, ["name", "contact", "country", "type"])


@api_router.patch("/buyers/{item_id}/archive")
async def archive_buyer(item_id: str, payload: ArchivePayload):
    return await _update(store.buyers, item_id, {"archived": payload.archived}, ["archived"])


@api_router.delete("/buyers/{item_id}")
async def delete_buyer(item_id: str):
    await _delete(store.buyers, item_id)
    return {"ok": True}


# ============ PRODUCT TYPES ============
@api_router.get("/product-types", response_model=List[ProductType])
async def list_product_types(include_archived: bool = False):
    return await _list(store.product_types, include_archived)


@api_router.post("/product-types", response_model=ProductType)
async def create_product_type(payload: ProductTypeCreate):
    obj = ProductType(**payload.model_dump())
    await _create(store.product_types, obj.model_dump())
    return obj


@api_router.patch("/product-types/{item_id}", response_model=ProductType)
async def update_product_type(item_id: str, updates: Dict[str, Any]):
    return await _update(store.product_types, item_id, updates, ["name", "avg_fabric_per_piece_kg", "description"])


@api_router.patch("/product-types/{item_id}/archive")
async def archive_product_type(item_id: str, payload: ArchivePayload):
    return await _update(store.product_types, item_id, {"archived": payload.archived}, ["archived"])


@api_router.delete("/product-types/{item_id}")
async def delete_product_type(item_id: str):
    await _delete(store.product_types, item_id)
    return {"ok": True}


# ============ VENDORS ============
@api_router.get("/vendors", response_model=List[Vendor])
async def list_vendors(include_archived: bool = False):
    return await _list(store.vendors, include_archived)


@api_router.post("/vendors", response_model=Vendor)
async def create_vendor(payload: VendorCreate):
    obj = Vendor(**payload.model_dump())
    await _create(store.vendors, obj.model_dump())
    return obj


@api_router.patch("/vendors/{item_id}", response_model=Vendor)
async def update_vendor(item_id: str, updates: Dict[str, Any]):
    return await _update(store.vendors, item_id, updates, ["name", "type", "contact", "location"])


@api_router.patch("/vendors/{item_id}/archive")
async def archive_vendor(item_id: str, payload: ArchivePayload):
    return await _update(store.vendors, item_id, {"archived": payload.archived}, ["archived"])


@api_router.delete("/vendors/{item_id}")
async def delete_vendor(item_id: str):
    await _delete(store.vendors, item_id)
    return {"ok": True}


# ============ FABRIC LOTS ============
@api_router.get("/fabric-lots")
async def list_fabric_lots(include_archived: bool = False):
    lots = await _list(store.fabric_lots, include_archived)
    if not lots:
        return lots
    lot_ids = [l["id"] for l in lots]
    with SessionLocal() as session:
        rows = session.query(
            FabricDispatchORM.fabric_lot_id,
            func.sum(FabricDispatchORM.kg_dispatched).label("total"),
        ).filter(
            FabricDispatchORM.fabric_lot_id.in_(lot_ids),
            FabricDispatchORM.archived.isnot(True),
        ).group_by(FabricDispatchORM.fabric_lot_id).all()
        totals = {row.fabric_lot_id: float(row.total or 0.0) for row in rows}
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
    created = await _create(store.fabric_lots, obj.model_dump())
    with SessionLocal() as session:
        lot_row = session.query(FabricLotORM).filter(FabricLotORM.id == created.get("id")).first()
        if lot_row is not None:
            _upsert_fabric_payable(session, lot_row)
            session.commit()
    return obj


@api_router.patch("/fabric-lots/{item_id}", response_model=FabricLot)
async def update_fabric_lot(item_id: str, updates: Dict[str, Any]):
    updated = await _update(store.fabric_lots, item_id, updates,
                         ["fabric_type", "color", "supplier", "kg_received", "cost_per_kg", "date_received", "notes"])
    with SessionLocal() as session:
        lot_row = session.query(FabricLotORM).filter(FabricLotORM.id == item_id).first()
        if lot_row is not None:
            _upsert_fabric_payable(session, lot_row)
            session.commit()
    return updated


@api_router.patch("/fabric-lots/{item_id}/archive")
async def archive_fabric_lot(item_id: str, payload: ArchivePayload):
    return await _update(store.fabric_lots, item_id, {"archived": payload.archived}, ["archived"])


@api_router.delete("/fabric-lots/{item_id}")
async def delete_fabric_lot(item_id: str):
    await _delete(store.fabric_lots, item_id)
    return {"ok": True}


# ============ MATERIAL INVENTORY ============
@api_router.get("/material-inventory", response_model=List[MaterialInventory])
async def list_material_inventory(include_archived: bool = False):
    return await _list(store.material_inventory, include_archived)


@api_router.post("/material-inventory", response_model=MaterialInventory)
async def create_material_inventory(payload: MaterialInventoryCreate):
    data = payload.model_dump()
    if not data.get("date"):
        data["date"] = now_iso()
    if not data.get("material_name") or not data.get("supplier"):
        raise HTTPException(status_code=400, detail="Material name and supplier are required")
    if data.get("quantity", 0) <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be greater than zero")
    if data.get("rate", 0) <= 0:
        raise HTTPException(status_code=400, detail="Rate must be greater than zero")
    data["amount"] = round(float(data["quantity"]) * float(data["rate"]), 2)
    obj = MaterialInventory(**data)
    created = await _create(store.material_inventory, obj.model_dump())
    with SessionLocal() as session:
        inventory_row = session.query(MaterialInventoryORM).filter(MaterialInventoryORM.id == created.get("id")).first()
        if inventory_row is not None:
            _upsert_material_payable(session, inventory_row)
            session.commit()
    return created


@api_router.patch("/material-inventory/{item_id}", response_model=MaterialInventory)
async def update_material_inventory(item_id: str, updates: Dict[str, Any]):
    existing = await _get(store.material_inventory, item_id)

    clean_updates = {k: v for k, v in updates.items() if k in {
        "date", "material_name", "supplier", "quantity", "unit", "rate", "notes"
    }}

    quantity = float(clean_updates.get("quantity", existing.get("quantity", 0)))
    rate = float(clean_updates.get("rate", existing.get("rate", 0)))
    if quantity <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be greater than zero")
    if rate <= 0:
        raise HTTPException(status_code=400, detail="Rate must be greater than zero")

    clean_updates["amount"] = round(quantity * rate, 2)
    updated = await _update(
        store.material_inventory,
        item_id,
        clean_updates,
        ["date", "material_name", "supplier", "quantity", "unit", "rate", "amount", "notes"],
    )
    with SessionLocal() as session:
        inventory_row = session.query(MaterialInventoryORM).filter(MaterialInventoryORM.id == item_id).first()
        if inventory_row is not None:
            _upsert_material_payable(session, inventory_row)
            session.commit()
    return updated


@api_router.delete("/material-inventory/{item_id}")
async def delete_material_inventory(item_id: str):
    await _delete(store.material_inventory, item_id)
    return {"ok": True}


def _parse_allocations(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, str):
        try:
            data = json.loads(payload)
            return data if isinstance(data, list) else []
        except Exception:
            return []
    return []


def _material_available_quantity(session, material_name: str, unit: str) -> float:
    total = session.query(func.sum(MaterialInventoryORM.quantity)).filter(
        MaterialInventoryORM.material_name == material_name,
        MaterialInventoryORM.unit == unit,
        MaterialInventoryORM.archived.isnot(True),
    ).scalar() or 0.0
    return float(total)


def _allocate_material_stock(session, material_name: str, unit: str, required_qty: float) -> List[Dict[str, Any]]:
    available_qty = _material_available_quantity(session, material_name, unit)
    if required_qty > available_qty + 1e-9:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient stock for {material_name} ({unit}). Available: {available_qty:.3f}, required: {required_qty:.3f}",
        )

    remaining = float(required_qty)
    allocations: List[Dict[str, Any]] = []

    rows = session.query(MaterialInventoryORM).filter(
        MaterialInventoryORM.material_name == material_name,
        MaterialInventoryORM.unit == unit,
        MaterialInventoryORM.archived.isnot(True),
        MaterialInventoryORM.quantity > 0,
    ).order_by(
        MaterialInventoryORM.date.desc(),
        MaterialInventoryORM.created_at.desc(),
        MaterialInventoryORM.id.desc(),
    ).all()

    for row in rows:
        if remaining <= 1e-9:
            break
        take = min(float(row.quantity), remaining)
        if take <= 0:
            continue
        row.quantity = round(float(row.quantity) - take, 3)
        row.amount = round(float(row.quantity) * float(row.rate or 0), 2)
        allocations.append({"material_inventory_id": row.id, "quantity": round(take, 3)})
        remaining = round(remaining - take, 3)

    if remaining > 1e-6:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient stock for {material_name} ({unit}). Available: {available_qty:.3f}, required: {required_qty:.3f}",
        )

    return allocations


def _restore_material_stock(session, allocations: List[Dict[str, Any]]) -> None:
    for allocation in allocations:
        row_id = allocation.get("material_inventory_id")
        qty = float(allocation.get("quantity", 0) or 0)
        if not row_id or qty <= 0:
            continue
        row = session.query(MaterialInventoryORM).filter(MaterialInventoryORM.id == row_id).first()
        if row is None:
            continue
        row.quantity = round(float(row.quantity or 0) + qty, 3)
        row.amount = round(float(row.quantity) * float(row.rate or 0), 2)


def _material_dispatch_rate(session, allocations: List[Dict[str, Any]]) -> float:
    total_value = 0.0
    total_quantity = 0.0
    for allocation in allocations:
        row_id = allocation.get("material_inventory_id")
        qty = float(allocation.get("quantity", 0) or 0)
        if not row_id or qty <= 0:
            continue
        row = session.query(MaterialInventoryORM).filter(MaterialInventoryORM.id == row_id).first()
        if row is None:
            continue
        total_value += float(qty) * float(row.rate or 0)
        total_quantity += float(qty)
    if total_quantity <= 0:
        return 0.0
    return round(total_value / total_quantity, 2)


def _recalculate_payable_amounts(session, payable_row: PayableORM) -> None:
    original_job_work_amount = float(payable_row.original_job_work_amount or 0.0)
    total_material_adjustment = float(payable_row.total_material_adjustment or 0.0)
    net_payable_amount = round(original_job_work_amount + total_material_adjustment, 2)
    if net_payable_amount <= 0 and float(payable_row.total_amount or 0.0) > 0:
        net_payable_amount = round(float(payable_row.total_amount or 0.0), 2)
    outstanding_balance = round(max(net_payable_amount - float(payable_row.paid_amount or 0.0), 0.0), 2)
    payable_row.total_amount = round(net_payable_amount, 2)
    payable_row.net_payable_amount = net_payable_amount
    payable_row.outstanding_balance = outstanding_balance
    payable_row.balance_amount = outstanding_balance
    payable_row.status = _payment_status(net_payable_amount, float(payable_row.paid_amount or 0.0))


def _upsert_material_payable(session, inventory_row: MaterialInventoryORM) -> None:
    note_token = f"material_inventory_id:{inventory_row.id}"
    total_amount = round(float(inventory_row.amount or 0.0), 2)
    vendor_name = (inventory_row.supplier or "Unknown Vendor").strip() or "Unknown Vendor"
    existing = session.query(PayableORM).filter(PayableORM.notes.like(f"%{note_token}%")) .first()
    existing_notes = existing.notes or "" if existing else ""
    note_text = existing_notes or ""
    if note_token not in note_text:
        note_text = f"{note_text} | {note_token}".strip(" |") if note_text else note_token
    if existing is not None:
        existing.vendor = vendor_name
        existing.reference_no = f"MI-{inventory_row.id}"
        existing.source = "Material Purchase"
        existing.original_job_work_amount = round(float(existing.original_job_work_amount or 0.0), 2)
        existing.total_material_adjustment = round(float(existing.total_material_adjustment or 0.0), 2)
        existing.total_amount = round(existing.original_job_work_amount + existing.total_material_adjustment, 2)
        existing.balance_amount = round(max(existing.total_amount - float(existing.paid_amount or 0), 0), 2)
        existing.net_payable_amount = round(existing.total_amount, 2)
        existing.outstanding_balance = round(max(existing.total_amount - float(existing.paid_amount or 0), 0), 2)
        existing.status = _payment_status(existing.total_amount, float(existing.paid_amount or 0))
        existing.notes = note_text
        party = _resolve_party_from_name(session, vendor_name, "Supplier")
        if party is not None:
            _upsert_party_ledger_entry(
                session,
                party,
                inventory_row.date or now_utc(),
                "Material Purchase",
                f"MI-{inventory_row.id}",
                "Material purchase",
                round(float(existing.total_amount or 0.0), 2),
                0.0,
                "Material purchase",
                "material_inventory",
                inventory_row.id,
                "Debit",
            )
        return
    session.add(PayableORM(
        company_id=_ensure_default_company_id(),
        vendor=vendor_name,
        reference_no=f"MI-{inventory_row.id}",
        source="Material Purchase",
        total_amount=total_amount,
        original_job_work_amount=0.0,
        paid_amount=0.0,
        total_material_adjustment=0.0,
        net_payable_amount=total_amount,
        outstanding_balance=total_amount,
        balance_amount=total_amount,
        status=_payment_status(total_amount, 0.0),
        notes=note_text,
    ))
    session.flush()
    party = _resolve_party_from_name(session, vendor_name, "Supplier")
    if party is not None:
        _upsert_party_ledger_entry(
            session,
            party,
            inventory_row.date or now_utc(),
            "Material Purchase",
            f"MI-{inventory_row.id}",
            "Material purchase",
            round(float(total_amount or 0.0), 2),
            0.0,
            "Material purchase",
            "material_inventory",
            inventory_row.id,
            "Debit",
        )


def _upsert_material_adjustment(session, dispatch_row: MaterialDispatchORM, amount: float) -> None:
    note_token = f"material_dispatch_id:{dispatch_row.id}"
    if not dispatch_row.vendor_id:
        return

    payable = session.query(PayableORM).filter(PayableORM.notes.like(f"%{note_token}%")).first()
    if payable is None:
        payable = PayableORM(
            company_id=_ensure_default_company_id(),
            vendor=(session.query(VendorORM).filter(VendorORM.id == dispatch_row.vendor_id).first().name if session.query(VendorORM).filter(VendorORM.id == dispatch_row.vendor_id).first() else "Unknown Vendor"),
            reference_no=f"MD-{dispatch_row.id}",
            source="Job Work",
            total_amount=0.0,
            original_job_work_amount=0.0,
            paid_amount=0.0,
            total_material_adjustment=0.0,
            net_payable_amount=0.0,
            outstanding_balance=0.0,
            balance_amount=0.0,
            status="Pending",
            notes=note_token,
        )
        session.add(payable)
        session.flush()

    existing_notes = payable.notes or ""
    note_text = existing_notes or ""
    if note_token not in note_text:
        note_text = f"{note_text} | {note_token}".strip(" |") if note_text else note_token
    payable.notes = note_text
    payable.source = "Job Work"
    party = _resolve_party_from_name(session, payable.vendor or "", "Vendor")
    if party is not None:
        _upsert_party_ledger_entry(
            session,
            party,
            dispatch_row.date or now_utc(),
            "Material Dispatch",
            dispatch_row.dispatch_no or f"MD-{dispatch_row.id}",
            "Material dispatch",
            round(float(amount or 0.0), 2),
            0.0,
            "Material dispatch",
            "material_dispatch",
            str(dispatch_row.id),
            "Debit",
        )

    existing_adjustment = session.query(MaterialAdjustmentORM).filter(
        MaterialAdjustmentORM.material_dispatch_id == dispatch_row.id,
        MaterialAdjustmentORM.payable_id == payable.id,
        MaterialAdjustmentORM.archived.isnot(True),
    ).order_by(MaterialAdjustmentORM.created_at.desc()).first()

    if existing_adjustment is None:
        session.add(MaterialAdjustmentORM(
            company_id=_ensure_default_company_id(),
            material_dispatch_id=dispatch_row.id,
            payable_id=payable.id,
            amount=round(float(amount or 0.0), 2),
            notes=note_token,
        ))
        session.flush()
    else:
        existing_adjustment.amount = round(float(amount or 0.0), 2)
        existing_adjustment.notes = note_token
        session.flush()

    adjustments = session.query(MaterialAdjustmentORM).filter(
        MaterialAdjustmentORM.payable_id == payable.id,
        MaterialAdjustmentORM.archived.isnot(True),
    ).all()
    total_adjustment = round(sum(float(item.amount or 0.0) for item in adjustments), 2)
    payable.total_material_adjustment = total_adjustment
    _recalculate_payable_amounts(session, payable)

    existing_tx = session.query(PaymentTransactionORM).filter(
        PaymentTransactionORM.payable_id == payable.id,
        PaymentTransactionORM.transaction_type == "Adjustment",
        PaymentTransactionORM.notes.like(f"%{note_token}%"),
        PaymentTransactionORM.archived.isnot(True),
    ).first()
    if existing_tx is None:
        session.add(PaymentTransactionORM(
            company_id=_ensure_default_company_id(),
            date=dispatch_row.date,
            transaction_type="Adjustment",
            party=payable.vendor or "Unknown Vendor",
            reference_no=dispatch_row.dispatch_no or f"MD-{dispatch_row.id}",
            payable_id=payable.id,
            receivable_id=None,
            amount=round(float(amount or 0.0), 2),
            payment_mode="Cash",
            notes=note_token,
        ))
    else:
        existing_tx.amount = round(float(amount or 0.0), 2)
        existing_tx.reference_no = dispatch_row.dispatch_no or f"MD-{dispatch_row.id}"
        existing_tx.notes = note_token


def _upsert_material_receivable(session, dispatch_row: MaterialDispatchORM, amount: float, customer_name: str) -> None:
    note_token = f"material_dispatch_id:{dispatch_row.id}"
    invoice_no = dispatch_row.dispatch_no or f"MD-{dispatch_row.id}"
    existing = session.query(ReceivableORM).filter(
        ReceivableORM.company_id == _current_company_id(),
        ReceivableORM.notes.like(f"%{note_token}%"),
        ReceivableORM.archived.isnot(True),
    ).first()
    if existing is None:
        existing = session.query(ReceivableORM).filter(
            ReceivableORM.invoice_no == invoice_no,
            ReceivableORM.archived.isnot(True),
        ).first()
    existing_notes = existing.notes or "" if existing else ""
    note_text = existing_notes or ""
    if note_token not in note_text:
        note_text = f"{note_text} | {note_token}".strip(" |") if note_text else note_token
    if existing is not None:
        existing.customer = customer_name
        existing.invoice_no = invoice_no
        existing.total_amount = round(float(amount or 0.0), 2)
        existing.balance_amount = round(max(float(amount or 0.0) - float(existing.received_amount or 0), 0), 2)
        existing.status = _payment_status(float(amount or 0.0), float(existing.received_amount or 0))
        existing.notes = note_text
        return
    session.add(ReceivableORM(
        company_id=_ensure_default_company_id(),
        customer=customer_name,
        invoice_no=invoice_no,
        total_amount=round(float(amount or 0.0), 2),
        received_amount=0.0,
        balance_amount=round(float(amount or 0.0), 2),
        status=_payment_status(float(amount or 0.0), 0.0),
        notes=note_text,
    ))


def _upsert_fabric_payable(session, lot_row: FabricLotORM) -> None:
    note_token = f"fabric_lot_id:{lot_row.id}"
    total_amount = round(float(lot_row.kg_received or 0.0) * float(lot_row.cost_per_kg or 0.0), 2)
    vendor_name = (lot_row.supplier or "Unknown Vendor").strip() or "Unknown Vendor"
    existing = session.query(PayableORM).filter(PayableORM.notes.like(f"%{note_token}%")).first()
    existing_notes = existing.notes or "" if existing else ""
    note_text = existing_notes or ""
    if note_token not in note_text:
        note_text = f"{note_text} | {note_token}".strip(" |") if note_text else note_token
    if existing is not None:
        existing.vendor = vendor_name
        existing.reference_no = f"FL-{lot_row.id}"
        existing.source = "Fabric Purchase"
        existing.total_amount = total_amount
        existing.balance_amount = round(max(total_amount - float(existing.paid_amount or 0), 0), 2)
        existing.status = _payment_status(total_amount, float(existing.paid_amount or 0))
        existing.notes = note_text
        party = _resolve_party_from_name(session, vendor_name, "Supplier")
        if party is not None:
            _upsert_party_ledger_entry(
                session,
                party,
                lot_row.date_received or now_utc(),
                "Fabric Purchase",
                f"FL-{lot_row.id}",
                "Fabric purchase",
                round(float(total_amount or 0.0), 2),
                0.0,
                "Fabric purchase",
                "fabric_lot",
                lot_row.id,
                "Debit",
            )
        return
    session.add(PayableORM(
        company_id=_ensure_default_company_id(),
        vendor=vendor_name,
        reference_no=f"FL-{lot_row.id}",
        source="Fabric Purchase",
        total_amount=total_amount,
        paid_amount=0.0,
        balance_amount=total_amount,
        status=_payment_status(total_amount, 0.0),
        notes=note_text,
    ))


def _fabric_dispatch_receivable_amount(session, dispatch_row: FabricDispatchORM) -> float:
    lot_row = session.query(FabricLotORM).filter(FabricLotORM.id == dispatch_row.fabric_lot_id).first()
    rate = float(lot_row.cost_per_kg or 0.0) if lot_row is not None else 0.0
    return round(float(dispatch_row.kg_dispatched or 0.0) * rate, 2)


def _upsert_fabric_receivable(session, dispatch_row: FabricDispatchORM, amount: float, customer_name: str) -> None:
    note_token = f"fabric_dispatch_id:{dispatch_row.id}"
    reference_no = _parse_dispatch_note_blob(dispatch_row.notes or "").get("dispatch_no") or str(dispatch_row.id)
    existing = session.query(ReceivableORM).filter(
        ReceivableORM.company_id == _current_company_id(),
        ReceivableORM.notes.like(f"%{note_token}%"),
        ReceivableORM.archived.isnot(True),
    ).first()
    if existing is None:
        existing = session.query(ReceivableORM).filter(
            ReceivableORM.invoice_no == reference_no,
            ReceivableORM.archived.isnot(True),
        ).first()
    existing_notes = existing.notes or "" if existing else ""
    note_text = existing_notes or ""
    if note_token not in note_text:
        note_text = f"{note_text} | {note_token}".strip(" |") if note_text else note_token

    amount_value = round(float(amount or 0.0), 2)
    if existing is not None:
        existing.customer = customer_name
        existing.invoice_no = reference_no
        existing.total_amount = amount_value
        existing.balance_amount = round(max(amount_value - float(existing.received_amount or 0), 0), 2)
        existing.status = _payment_status(amount_value, float(existing.received_amount or 0))
        existing.notes = note_text
    else:
        session.add(ReceivableORM(
            company_id=_ensure_default_company_id(),
            customer=customer_name,
            invoice_no=reference_no,
            total_amount=amount_value,
            received_amount=0.0,
            balance_amount=round(amount_value, 2),
            status=_payment_status(amount_value, 0.0),
            notes=note_text,
        ))

    party = _resolve_party_from_name(session, customer_name or dispatch_row.vendor_id or "", "Vendor")
    if party is not None:
        _upsert_party_ledger_entry(
            session,
            party,
            dispatch_row.date or now_utc(),
            "Fabric Dispatch",
            reference_no,
            "Fabric dispatch",
            0.0,
            amount_value,
            "Fabric dispatch",
            "fabric_dispatch",
            dispatch_row.id,
            "Credit",
        )


def _generate_dispatch_no(session, dispatch_date: datetime) -> str:
    day_key = dispatch_date.strftime("%Y%m%d")
    prefix = f"MD-{day_key}-"
    existing = session.query(MaterialDispatchORM.dispatch_no).filter(
        MaterialDispatchORM.dispatch_no.like(f"{prefix}%")
    ).all()
    max_seq = 0
    for row in existing:
        value = row.dispatch_no or ""
        try:
            seq = int(value.split("-")[-1])
            max_seq = max(max_seq, seq)
        except Exception:
            continue
    return f"{prefix}{max_seq + 1:04d}"


def _coerce_dispatch_date(value: Optional[str]) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    coerced = _coerce_value(MaterialDispatchORM, "date", value)
    if isinstance(coerced, datetime):
        return coerced
    return datetime.now(timezone.utc)


def _payment_status(total_amount: float, paid_amount: float) -> str:
    total_amount = float(total_amount or 0)
    paid_amount = float(paid_amount or 0)
    if total_amount <= 0:
        return "Pending"
    if paid_amount >= total_amount - 1e-9:
        return "Paid"
    if paid_amount <= 1e-9:
        return "Pending"
    return "Partial"


def _party_type_for_name(party_type: Optional[str]) -> str:
    value = (party_type or "").strip().lower()
    if value in {"supplier", "suppliers"}:
        return "Supplier"
    if value in {"customer", "customers"}:
        return "Customer"
    return "Vendor"


def _resolve_party_from_name(session, party_name: Optional[str], party_type: Optional[str] = None) -> Optional[PartyORM]:
    if not party_name:
        return None
    name = str(party_name).strip()
    if not name:
        return None
    query = session.query(PartyORM).filter(PartyORM.company_id == _current_company_id(), PartyORM.name == name, PartyORM.archived.isnot(True))
    if party_type:
        query = query.filter(PartyORM.party_type == _party_type_for_name(party_type))
    return query.first()


def _serialize_party_ledger_entry(row: PartyLedgerEntryORM) -> Dict[str, Any]:
    return {
        "id": row.id,
        "party_id": row.party_id,
        "party_type": row.party_type,
        "entry_date": _dt_to_iso(row.entry_date),
        "module_name": row.module_name,
        "reference_no": row.reference_no,
        "description": row.description,
        "debit": round(float(row.debit or 0.0), 2),
        "credit": round(float(row.credit or 0.0), 2),
        "running_balance": round(float(row.running_balance or 0.0), 2),
        "remarks": row.remarks,
        "source_type": row.source_type,
        "source_id": row.source_id,
        "transaction_type": row.transaction_type,
        "created_at": _dt_to_iso(row.created_at),
    }


def _archive_party_ledger_entries_for_source(session, source_type: str, source_id: str) -> None:
    entries = session.query(PartyLedgerEntryORM).filter(
        PartyLedgerEntryORM.company_id == _current_company_id(),
        PartyLedgerEntryORM.source_type == source_type,
        PartyLedgerEntryORM.source_id == str(source_id),
        PartyLedgerEntryORM.archived.isnot(True),
    ).all()
    for entry in entries:
        entry.archived = True
    party_ids = {entry.party_id for entry in entries}
    for party_id in party_ids:
        _recalculate_party_ledger(session, party_id)


def _upsert_party_ledger_entry(session, party, entry_date, module_name, reference_no, description, debit, credit, remarks, source_type, source_id, transaction_type) -> PartyLedgerEntryORM:
    if not party:
        return None
    party_type = _party_type_for_name(getattr(party, "party_type", None) or getattr(party, "type", None))
    existing = session.query(PartyLedgerEntryORM).filter(
        PartyLedgerEntryORM.company_id == _current_company_id(),
        PartyLedgerEntryORM.party_id == party.id,
        PartyLedgerEntryORM.source_type == source_type,
        PartyLedgerEntryORM.source_id == source_id,
        PartyLedgerEntryORM.archived.isnot(True),
    ).first()
    if existing is None:
        existing = session.query(PartyLedgerEntryORM).filter(
            PartyLedgerEntryORM.company_id == _current_company_id(),
            PartyLedgerEntryORM.party_id == party.id,
            PartyLedgerEntryORM.module_name == module_name,
            PartyLedgerEntryORM.reference_no == str(reference_no or ""),
            PartyLedgerEntryORM.archived.isnot(True),
        ).order_by(PartyLedgerEntryORM.created_at.desc()).first()
    if existing is None:
        existing = PartyLedgerEntryORM(
            company_id=_current_company_id(),
            party_id=party.id,
            party_type=party_type,
            entry_date=_coerce_value(PartyLedgerEntryORM, "entry_date", entry_date) if entry_date is not None else now_utc(),
            module_name=module_name,
            reference_no=reference_no,
            description=description,
            debit=round(float(debit or 0.0), 2),
            credit=round(float(credit or 0.0), 2),
            running_balance=0.0,
            remarks=remarks,
            source_type=source_type,
            source_id=source_id,
            transaction_type=transaction_type,
        )
        session.add(existing)
        session.flush()
    else:
        existing.party_type = party_type
        existing.entry_date = _coerce_value(PartyLedgerEntryORM, "entry_date", entry_date) if entry_date is not None else existing.entry_date
        existing.module_name = module_name
        existing.reference_no = reference_no
        existing.description = description
        existing.debit = round(float(debit or 0.0), 2)
        existing.credit = round(float(credit or 0.0), 2)
        existing.remarks = remarks
        existing.source_type = source_type
        existing.source_id = source_id
        existing.transaction_type = transaction_type
    _recalculate_party_ledger(session, party.id)
    return existing


def _recalculate_party_ledger(session, party_id: str) -> None:
    party = session.query(PartyORM).filter(PartyORM.id == party_id, PartyORM.company_id == _current_company_id()).first()
    if party is None:
        return
    entries = session.query(PartyLedgerEntryORM).filter(
        PartyLedgerEntryORM.company_id == _current_company_id(),
        PartyLedgerEntryORM.party_id == party_id,
        PartyLedgerEntryORM.archived.isnot(True),
    ).all()
    running = float(party.opening_balance or 0.0)
    opening_entries = [entry for entry in entries if (entry.module_name or "").strip() == "Opening Balance"]
    other_entries = [entry for entry in entries if (entry.module_name or "").strip() != "Opening Balance"]
    for entry in opening_entries:
        entry.running_balance = round(running, 2)
    for entry in sorted(
        other_entries,
        key=lambda entry: (
            entry.entry_date or datetime.min.replace(tzinfo=timezone.utc),
            entry.created_at or datetime.min.replace(tzinfo=timezone.utc),
        ),
    ):
        running += float(entry.debit or 0.0) - float(entry.credit or 0.0)
        entry.running_balance = round(running, 2)


def _recalculate_payment_balances(session, payable_id: Optional[str] = None, receivable_id: Optional[str] = None) -> None:
    if payable_id:
        payable = session.query(PayableORM).filter(PayableORM.id == payable_id).first()
        if payable is not None:
            _recalculate_payable_amounts(session, payable)
    if receivable_id:
        receivable = session.query(ReceivableORM).filter(ReceivableORM.id == receivable_id).first()
        if receivable is not None:
            receivable.balance_amount = round(max(float(receivable.total_amount or 0) - float(receivable.received_amount or 0), 0), 2)
            receivable.status = _payment_status(receivable.total_amount, receivable.received_amount)


def _sync_payment_targets(session, transaction: PaymentTransactionORM) -> None:
    if transaction.transaction_type == "Payment Given" and transaction.payable_id:
        payable = session.query(PayableORM).filter(PayableORM.id == transaction.payable_id).first()
        if payable is not None:
            payable.paid_amount = round(float(payable.paid_amount or 0) + float(transaction.amount or 0), 2)
            _recalculate_payment_balances(session, payable_id=payable.id)
    elif transaction.transaction_type == "Payment Received" and transaction.receivable_id:
        receivable = session.query(ReceivableORM).filter(ReceivableORM.id == transaction.receivable_id).first()
        if receivable is not None:
            receivable.received_amount = round(float(receivable.received_amount or 0) + float(transaction.amount or 0), 2)
            _recalculate_payment_balances(session, receivable_id=receivable.id)


def _remove_transaction_from_target(session, transaction: PaymentTransactionORM) -> None:
    if transaction.transaction_type == "Payment Given" and transaction.payable_id:
        payable = session.query(PayableORM).filter(PayableORM.id == transaction.payable_id).first()
        if payable is not None:
            payable.paid_amount = round(max(float(payable.paid_amount or 0) - float(transaction.amount or 0), 0), 2)
            _recalculate_payment_balances(session, payable_id=payable.id)
    elif transaction.transaction_type == "Payment Received" and transaction.receivable_id:
        receivable = session.query(ReceivableORM).filter(ReceivableORM.id == transaction.receivable_id).first()
        if receivable is not None:
            receivable.received_amount = round(max(float(receivable.received_amount or 0) - float(transaction.amount or 0), 0), 2)
            _recalculate_payment_balances(session, receivable_id=receivable.id)


# ============ PAYABLES ============
@api_router.get("/payables", response_model=List[Payable])
async def list_payables(include_archived: bool = False):
    return await _list(store.payables, include_archived)


@api_router.post("/payables", response_model=Payable)
async def create_payable(payload: PayableCreate):
    if payload.total_amount < 0 or payload.paid_amount < 0:
        raise HTTPException(status_code=400, detail="Amounts cannot be negative")
    if payload.paid_amount > payload.total_amount:
        raise HTTPException(status_code=400, detail="Paid amount cannot exceed total amount")
    data = payload.model_dump()
    data["balance_amount"] = round(max(payload.total_amount - payload.paid_amount, 0), 2)
    data["status"] = _payment_status(payload.total_amount, payload.paid_amount)
    obj = Payable(**data)
    created = await _create(store.payables, obj.model_dump())
    with SessionLocal() as session:
        payable_row = session.query(PayableORM).filter(PayableORM.id == created.get("id")).first()
        if payable_row is not None:
            party = _resolve_party_from_name(session, payable_row.vendor or "", "Vendor")
            module_name = "Job Work Bills" if str(payable_row.source or "").strip().lower() == "job work" else "Payables"
            if party is not None:
                _upsert_party_ledger_entry(
                    session,
                    party,
                    payable_row.created_at or now_utc(),
                    module_name,
                    payable_row.reference_no or payable_row.id,
                    "Payable entry",
                    round(float(payable_row.total_amount or 0.0), 2),
                    0.0,
                    "Payable entry",
                    "payable",
                    payable_row.id,
                    "Debit",
                )
            session.commit()
    return obj


@api_router.patch("/payables/{item_id}", response_model=Payable)
async def update_payable(item_id: str, updates: Dict[str, Any]):
    existing = await _get(store.payables, item_id)
    clean_updates = {k: v for k, v in updates.items() if k in {"vendor", "reference_no", "source", "total_amount", "paid_amount", "due_date", "notes"}}
    if "total_amount" in clean_updates and float(clean_updates["total_amount"]) < 0:
        raise HTTPException(status_code=400, detail="Amounts cannot be negative")
    if "paid_amount" in clean_updates and float(clean_updates["paid_amount"]) < 0:
        raise HTTPException(status_code=400, detail="Amounts cannot be negative")
    total_amount = float(clean_updates.get("total_amount", existing.get("total_amount", 0)))
    paid_amount = float(clean_updates.get("paid_amount", existing.get("paid_amount", 0)))
    if paid_amount > total_amount:
        raise HTTPException(status_code=400, detail="Paid amount cannot exceed total amount")
    clean_updates["balance_amount"] = round(max(total_amount - paid_amount, 0), 2)
    clean_updates["status"] = _payment_status(total_amount, paid_amount)
    updated = await _update(store.payables, item_id, clean_updates, ["vendor", "reference_no", "source", "total_amount", "paid_amount", "balance_amount", "due_date", "status", "notes"])
    with SessionLocal() as session:
        payable_row = session.query(PayableORM).filter(PayableORM.id == item_id).first()
        if payable_row is not None:
            party = _resolve_party_from_name(session, payable_row.vendor or "", "Vendor")
            module_name = "Job Work Bills" if str(payable_row.source or "").strip().lower() == "job work" else "Payables"
            if party is not None:
                _upsert_party_ledger_entry(
                    session,
                    party,
                    payable_row.created_at or now_utc(),
                    module_name,
                    payable_row.reference_no or payable_row.id,
                    "Payable entry",
                    round(float(payable_row.total_amount or 0.0), 2),
                    0.0,
                    "Payable entry",
                    "payable",
                    payable_row.id,
                    "Debit",
                )
            session.commit()
    return updated


@api_router.patch("/payables/{item_id}/archive")
async def archive_payable(item_id: str, payload: ArchivePayload):
    return await _update(store.payables, item_id, {"archived": payload.archived}, ["archived"])


@api_router.delete("/payables/{item_id}")
async def delete_payable(item_id: str):
    await _delete(store.payables, item_id)
    return {"ok": True}


# ============ RECEIVABLES ============
@api_router.get("/receivables", response_model=List[Receivable])
async def list_receivables(include_archived: bool = False):
    return await _list(store.receivables, include_archived)


@api_router.post("/receivables", response_model=Receivable)
async def create_receivable(payload: ReceivableCreate):
    if payload.total_amount < 0 or payload.received_amount < 0:
        raise HTTPException(status_code=400, detail="Amounts cannot be negative")
    if payload.received_amount > payload.total_amount:
        raise HTTPException(status_code=400, detail="Received amount cannot exceed total amount")
    data = payload.model_dump()
    data["balance_amount"] = round(max(payload.total_amount - payload.received_amount, 0), 2)
    data["status"] = _payment_status(payload.total_amount, payload.received_amount)
    obj = Receivable(**data)
    created = await _create(store.receivables, obj.model_dump())
    with SessionLocal() as session:
        party = _resolve_party_from_name(session, payload.customer or "", "Customer")
        if party is not None:
            _upsert_party_ledger_entry(
                session,
                party,
                obj.date,
                "Receipts",
                payload.invoice_no or created["id"],
                "Customer receivable",
                0.0,
                round(float(payload.total_amount or 0.0), 2),
                "Receivable",
                "receivable",
                created["id"],
                "Receipt",
            )
            session.commit()
    return obj


@api_router.patch("/receivables/{item_id}", response_model=Receivable)
async def update_receivable(item_id: str, updates: Dict[str, Any]):
    existing = await _get(store.receivables, item_id)
    clean_updates = {k: v for k, v in updates.items() if k in {"customer", "invoice_no", "total_amount", "received_amount", "due_date", "notes"}}
    if "total_amount" in clean_updates and float(clean_updates["total_amount"]) < 0:
        raise HTTPException(status_code=400, detail="Amounts cannot be negative")
    if "received_amount" in clean_updates and float(clean_updates["received_amount"]) < 0:
        raise HTTPException(status_code=400, detail="Amounts cannot be negative")
    total_amount = float(clean_updates.get("total_amount", existing.get("total_amount", 0)))
    received_amount = float(clean_updates.get("received_amount", existing.get("received_amount", 0)))
    if received_amount > total_amount:
        raise HTTPException(status_code=400, detail="Received amount cannot exceed total amount")
    clean_updates["balance_amount"] = round(max(total_amount - received_amount, 0), 2)
    clean_updates["status"] = _payment_status(total_amount, received_amount)
    updated = await _update(store.receivables, item_id, clean_updates, ["customer", "invoice_no", "total_amount", "received_amount", "balance_amount", "due_date", "status", "notes"])
    with SessionLocal() as session:
        receivable_row = session.query(ReceivableORM).filter(ReceivableORM.id == item_id).first()
        if receivable_row is not None:
            party = _resolve_party_from_name(session, receivable_row.customer or "", "Customer")
            if party is not None:
                _upsert_party_ledger_entry(
                    session,
                    party,
                    receivable_row.created_at or now_utc(),
                    "Receipts",
                    receivable_row.invoice_no or receivable_row.id,
                    "Customer receivable",
                    0.0,
                    round(float(receivable_row.total_amount or 0.0), 2),
                    "Receivable",
                    "receivable",
                    receivable_row.id,
                    "Receipt",
                )
            session.commit()
    return updated


@api_router.patch("/receivables/{item_id}/archive")
async def archive_receivable(item_id: str, payload: ArchivePayload):
    return await _update(store.receivables, item_id, {"archived": payload.archived}, ["archived"])


@api_router.delete("/receivables/{item_id}")
async def delete_receivable(item_id: str):
    await _delete(store.receivables, item_id)
    return {"ok": True}


# ============ TRANSACTIONS ============
@api_router.get("/payment-transactions", response_model=List[PaymentTransaction])
async def list_payment_transactions(include_archived: bool = False):
    return await _list(store.payment_transactions, include_archived)


def _validate_payment_transaction_target(session, transaction: PaymentTransactionORM) -> None:
    if transaction.transaction_type == "Payment Received" and transaction.receivable_id:
        receivable = session.query(ReceivableORM).filter(ReceivableORM.id == transaction.receivable_id).first()
        if receivable is None:
            raise HTTPException(status_code=404, detail="Receivable not found")
        total_amount = float(receivable.total_amount or 0.0)
        projected_received = float(receivable.received_amount or 0.0)
        remaining = round(max(total_amount - projected_received, 0.0), 2)
        if float(transaction.amount or 0.0) > remaining + 1e-9:
            raise HTTPException(status_code=400, detail="Payment amount cannot exceed the receivable balance")
    if transaction.transaction_type == "Payment Given" and transaction.payable_id:
        payable = session.query(PayableORM).filter(PayableORM.id == transaction.payable_id).first()
        if payable is None:
            raise HTTPException(status_code=404, detail="Payable not found")
        total_amount = float(payable.total_amount or 0.0)
        projected_paid = float(payable.paid_amount or 0.0)
        remaining = round(max(total_amount - projected_paid, 0.0), 2)
        if float(transaction.amount or 0.0) > remaining + 1e-9:
            raise HTTPException(status_code=400, detail="Payment amount cannot exceed the payable balance")


@api_router.post("/payment-transactions", response_model=PaymentTransaction)
async def create_payment_transaction(payload: PaymentTransactionCreate):
    if payload.amount < 0:
        raise HTTPException(status_code=400, detail="Amounts cannot be negative")
    with SessionLocal() as session:
        row = _make_row_from_doc(PaymentTransactionORM, payload.model_dump())
        _validate_payment_transaction_target(session, row)
        session.add(row)
        session.commit()
        session.refresh(row)
        _sync_payment_targets(session, row)
        party = _resolve_party_from_name(session, row.party or "", None)
        if party is None and row.transaction_type == "Payment Received":
            party = _resolve_party_from_name(session, row.party or "", "Customer")
        if party is None and row.transaction_type != "Payment Received":
            party = _resolve_party_from_name(session, row.party or "", "Vendor")
        if party is not None:
            amount = round(float(row.amount or 0.0), 2)
            debit = amount if row.transaction_type == "Payment Received" else 0.0
            credit = amount if row.transaction_type != "Payment Received" else 0.0
            _upsert_party_ledger_entry(
                session,
                party,
                row.date or now_utc(),
                "Transactions",
                row.reference_no or row.id,
                "Payment transaction",
                debit,
                credit,
                "Payment transaction",
                "payment_transaction",
                row.id,
                "Receipt" if row.transaction_type == "Payment Received" else "Payment",
            )
        session.commit()
        session.refresh(row)
        return _serialize_row(PaymentTransactionORM, row)


@api_router.patch("/payment-transactions/{item_id}", response_model=PaymentTransaction)
async def update_payment_transaction(item_id: str, updates: Dict[str, Any]):
    with SessionLocal() as session:
        row = session.query(PaymentTransactionORM).filter(PaymentTransactionORM.id == item_id).first()
        if row is None:
            raise HTTPException(status_code=404, detail="Not found")
        old_amount = float(row.amount or 0)
        old_type = row.transaction_type
        old_payable_id = row.payable_id
        old_receivable_id = row.receivable_id
        if "amount" in updates and float(updates["amount"]) < 0:
            raise HTTPException(status_code=400, detail="Amounts cannot be negative")
        for key, value in updates.items():
            if key in {"date", "transaction_type", "party", "reference_no", "payable_id", "receivable_id", "amount", "payment_mode", "notes"}:
                setattr(row, key, value)
        if row.transaction_type == "Payment Received" and row.receivable_id:
            receivable = session.query(ReceivableORM).filter(ReceivableORM.id == row.receivable_id).first()
            if receivable is None:
                raise HTTPException(status_code=404, detail="Receivable not found")
            projected_received = float(receivable.received_amount or 0.0)
            if old_receivable_id == row.receivable_id:
                projected_received = max(projected_received - old_amount, 0.0)
            remaining = round(max(float(receivable.total_amount or 0.0) - projected_received, 0.0), 2)
            if float(row.amount or 0.0) > remaining + 1e-9:
                raise HTTPException(status_code=400, detail="Payment amount cannot exceed the receivable balance")
        if row.transaction_type == "Payment Given" and row.payable_id:
            payable = session.query(PayableORM).filter(PayableORM.id == row.payable_id).first()
            if payable is None:
                raise HTTPException(status_code=404, detail="Payable not found")
            projected_paid = float(payable.paid_amount or 0.0)
            if old_payable_id == row.payable_id:
                projected_paid = max(projected_paid - old_amount, 0.0)
            remaining = round(max(float(payable.total_amount or 0.0) - projected_paid, 0.0), 2)
            if float(row.amount or 0.0) > remaining + 1e-9:
                raise HTTPException(status_code=400, detail="Payment amount cannot exceed the payable balance")
        session.commit()
        session.refresh(row)
        _remove_transaction_from_target(session, PaymentTransactionORM(id=row.id, transaction_type=old_type, payable_id=old_payable_id, receivable_id=old_receivable_id, amount=old_amount))
        _sync_payment_targets(session, row)
        party = _resolve_party_from_name(session, row.party or "", None)
        if party is None and row.transaction_type == "Payment Received":
            party = _resolve_party_from_name(session, row.party or "", "Customer")
        if party is None and row.transaction_type != "Payment Received":
            party = _resolve_party_from_name(session, row.party or "", "Vendor")
        if party is not None:
            amount = round(float(row.amount or 0.0), 2)
            debit = amount if row.transaction_type == "Payment Received" else 0.0
            credit = amount if row.transaction_type != "Payment Received" else 0.0
            _upsert_party_ledger_entry(
                session,
                party,
                row.date or now_utc(),
                "Transactions",
                row.reference_no or row.id,
                "Payment transaction",
                debit,
                credit,
                "Payment transaction",
                "payment_transaction",
                row.id,
                "Receipt" if row.transaction_type == "Payment Received" else "Payment",
            )
        session.commit()
        session.refresh(row)
        return _serialize_row(PaymentTransactionORM, row)


@api_router.patch("/payment-transactions/{item_id}/archive")
async def archive_payment_transaction(item_id: str, payload: ArchivePayload):
    return await _update(store.payment_transactions, item_id, {"archived": payload.archived}, ["archived"])


@api_router.delete("/payment-transactions/{item_id}")
async def delete_payment_transaction(item_id: str):
    with SessionLocal() as session:
        row = session.query(PaymentTransactionORM).filter(PaymentTransactionORM.id == item_id).first()
        if row is None:
            raise HTTPException(status_code=404, detail="Not found")
        _remove_transaction_from_target(session, row)
        session.delete(row)
        session.commit()
    return {"ok": True}


@api_router.get("/party-ledger")
async def party_ledger(party_type: Optional[str] = None, party_id: Optional[str] = None, module: Optional[str] = None, search: Optional[str] = None, date_from: Optional[str] = None, date_to: Optional[str] = None):
    with SessionLocal() as session:
        party = None
        if party_id:
            party = session.query(PartyORM).filter(PartyORM.id == party_id, PartyORM.company_id == _current_company_id()).first()
        if party is None and party_type:
            party = session.query(PartyORM).filter(PartyORM.company_id == _current_company_id(), PartyORM.party_type == _party_type_for_name(party_type)).order_by(PartyORM.created_at.desc()).first()
        if party is None:
            party = session.query(PartyORM).filter(PartyORM.company_id == _current_company_id()).order_by(PartyORM.created_at.desc()).first()
        if party is None:
            return {"party": None, "entries": [], "summary": {"party_name": "", "party_type": "", "current_outstanding": 0.0, "last_transaction_date": None, "total_debit": 0.0, "total_credit": 0.0, "current_balance": 0.0}}
        query = session.query(PartyLedgerEntryORM).filter(
            PartyLedgerEntryORM.company_id == _current_company_id(),
            PartyLedgerEntryORM.party_id == party.id,
            PartyLedgerEntryORM.archived.isnot(True),
        )
        if module:
            query = query.filter(PartyLedgerEntryORM.module_name == module)
        if search:
            like = f"%{search}%"
            query = query.filter(
                (PartyLedgerEntryORM.reference_no.like(like)) |
                (PartyLedgerEntryORM.description.like(like)) |
                (PartyLedgerEntryORM.remarks.like(like)) |
                (PartyLedgerEntryORM.module_name.like(like))
            )
        if date_from:
            query = query.filter(PartyLedgerEntryORM.entry_date >= _coerce_value(PartyLedgerEntryORM, "entry_date", date_from))
        if date_to:
            query = query.filter(PartyLedgerEntryORM.entry_date <= _coerce_value(PartyLedgerEntryORM, "entry_date", date_to))
        entries = query.order_by(PartyLedgerEntryORM.entry_date.asc(), PartyLedgerEntryORM.created_at.asc()).all()
        _recalculate_party_ledger(session, party.id)
        session.commit()
        entries = query.order_by(PartyLedgerEntryORM.entry_date.asc(), PartyLedgerEntryORM.created_at.asc()).all()
        ordered_entries = sorted(
            entries,
            key=lambda entry: (
                0 if (entry.module_name or "").strip() == "Opening Balance" else 1,
                entry.entry_date or datetime.min.replace(tzinfo=timezone.utc),
                entry.created_at or datetime.min.replace(tzinfo=timezone.utc),
            ),
        )
        entry_payloads = [_serialize_party_ledger_entry(entry) for entry in ordered_entries]
        total_debit = round(sum(float(item["debit"]) for item in entry_payloads), 2)
        total_credit = round(sum(float(item["credit"]) for item in entry_payloads), 2)
        current_balance = round(float(party.opening_balance or 0.0) + total_debit - total_credit, 2)
        return {
            "party": _serialize_row(PartyORM, party),
            "entries": entry_payloads,
            "summary": {
                "party_name": party.name,
                "party_type": party.party_type,
                "current_outstanding": round(max(current_balance, 0.0), 2),
                "last_transaction_date": entry_payloads[-1]["entry_date"] if entry_payloads else None,
                "total_debit": total_debit,
                "total_credit": total_credit,
                "current_balance": current_balance,
            },
        }


@api_router.get("/export/party-ledger")
async def export_party_ledger(party_type: Optional[str] = None, party_id: Optional[str] = None, module: Optional[str] = None, search: Optional[str] = None, date_from: Optional[str] = None, date_to: Optional[str] = None):
    with SessionLocal() as session:
        party = None
        if party_id:
            party = session.query(PartyORM).filter(PartyORM.id == party_id, PartyORM.company_id == _current_company_id()).first()
        if party is None and party_type:
            party = session.query(PartyORM).filter(PartyORM.company_id == _current_company_id(), PartyORM.party_type == _party_type_for_name(party_type)).order_by(PartyORM.created_at.desc()).first()
        if party is None:
            party = session.query(PartyORM).filter(PartyORM.company_id == _current_company_id()).order_by(PartyORM.created_at.desc()).first()
        if party is None:
            return {"party": None, "entries": [], "summary": {"party_name": "", "party_type": "", "current_outstanding": 0.0, "last_transaction_date": None, "total_debit": 0.0, "total_credit": 0.0, "current_balance": 0.0}}
        query = session.query(PartyLedgerEntryORM).filter(
            PartyLedgerEntryORM.company_id == _current_company_id(),
            PartyLedgerEntryORM.party_id == party.id,
            PartyLedgerEntryORM.archived.isnot(True),
        )
        if module:
            query = query.filter(PartyLedgerEntryORM.module_name == module)
        if search:
            like = f"%{search}%"
            query = query.filter(
                (PartyLedgerEntryORM.reference_no.like(like)) |
                (PartyLedgerEntryORM.description.like(like)) |
                (PartyLedgerEntryORM.remarks.like(like)) |
                (PartyLedgerEntryORM.module_name.like(like))
            )
        if date_from:
            query = query.filter(PartyLedgerEntryORM.entry_date >= _coerce_value(PartyLedgerEntryORM, "entry_date", date_from))
        if date_to:
            query = query.filter(PartyLedgerEntryORM.entry_date <= _coerce_value(PartyLedgerEntryORM, "entry_date", date_to))
        entries = query.order_by(PartyLedgerEntryORM.entry_date.asc(), PartyLedgerEntryORM.created_at.asc()).all()
        ordered_entries = sorted(
            entries,
            key=lambda entry: (
                0 if (entry.module_name or "").strip() == "Opening Balance" else 1,
                entry.entry_date or datetime.min.replace(tzinfo=timezone.utc),
                entry.created_at or datetime.min.replace(tzinfo=timezone.utc),
            ),
        )
        export_rows = [
            {
                "Date": _dt_to_iso(entry.entry_date),
                "Party": party.name,
                "Party Type": party.party_type,
                "Module": entry.module_name or "",
                "Reference No.": entry.reference_no or "",
                "Description": entry.description or "",
                "Debit": round(float(entry.debit or 0.0), 2),
                "Credit": round(float(entry.credit or 0.0), 2),
                "Running Balance": round(float(entry.running_balance or 0.0), 2),
                "Remarks": entry.remarks or "",
            }
            for entry in ordered_entries
        ]

    try:
        import pandas as pd
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Excel export dependency error: {e}")

    df = pd.DataFrame(export_rows)
    buffer = io.BytesIO()
    try:
        with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
            df.to_excel(writer, index=False, sheet_name="Party Ledger")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate Excel file: {e}")

    buffer.seek(0)
    headers = {"Content-Disposition": "attachment; filename=party_ledger.xlsx"}
    return StreamingResponse(buffer, headers=headers, media_type="application/vnd.openxmlformats-officedocument/spreadsheetml.sheet")


@api_router.get("/payments/dashboard")
async def payments_dashboard():
    with SessionLocal() as session:
        payables = [_serialize_row(PayableORM, row) for row in session.query(PayableORM).filter(PayableORM.archived.isnot(True)).all()]
        receivables = [_serialize_row(ReceivableORM, row) for row in session.query(ReceivableORM).filter(ReceivableORM.archived.isnot(True)).all()]
        transactions = [_serialize_row(PaymentTransactionORM, row) for row in session.query(PaymentTransactionORM).filter(PaymentTransactionORM.archived.isnot(True)).all()]

    total_payable = round(sum(float(r.get("total_amount", 0) or 0) for r in payables), 2)
    paid = round(sum(float(r.get("paid_amount", 0) or 0) for r in payables), 2)
    balance_payable = round(max(total_payable - paid, 0), 2)
    total_receivable = round(sum(float(r.get("total_amount", 0) or 0) for r in receivables), 2)
    received = round(sum(float(r.get("received_amount", 0) or 0) for r in receivables), 2)
    balance_receivable = round(max(total_receivable - received, 0), 2)
    payment_given = round(sum(float(t.get("amount", 0) or 0) for t in transactions if t.get("transaction_type") == "Payment Given"), 2)
    payment_received = round(sum(float(t.get("amount", 0) or 0) for t in transactions if t.get("transaction_type") == "Payment Received"), 2)

    def parse_date(value):
        if not value:
            return None
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except Exception:
            return None

    now = datetime.now(timezone.utc)
    week_end = now + timedelta(days=7)
    due_this_week = [
        {
            "vendor": item.get("vendor"),
            "amount": item.get("balance_amount"),
            "due_date": item.get("due_date"),
            "status": item.get("status"),
        }
        for item in payables
        if parse_date(item.get("due_date")) and parse_date(item.get("due_date")) <= week_end and parse_date(item.get("due_date")) >= now
    ]
    receipts_this_week = [
        {
            "customer": item.get("customer"),
            "amount": item.get("balance_amount"),
            "due_date": item.get("due_date"),
            "status": item.get("status"),
        }
        for item in receivables
        if parse_date(item.get("due_date")) and parse_date(item.get("due_date")) <= week_end and parse_date(item.get("due_date")) >= now
    ]

    recent_payments = sorted([t for t in transactions if t.get("transaction_type") == "Payment Given"], key=lambda x: x.get("date") or "", reverse=True)[:5]
    recent_receipts = sorted([t for t in transactions if t.get("transaction_type") == "Payment Received"], key=lambda x: x.get("date") or "", reverse=True)[:5]

    return {
        "summary": {
            "total_payable": total_payable,
            "paid": paid,
            "balance_payable": balance_payable,
            "total_receivable": total_receivable,
            "received": received,
            "balance_receivable": balance_receivable,
            "total_payment_given": payment_given,
            "total_payment_received": payment_received,
        },
        "due_this_week": due_this_week,
        "receipts_this_week": receipts_this_week,
        "recent_payments": recent_payments,
        "recent_receipts": recent_receipts,
    }


@api_router.post("/import/payables")
async def import_payables(file: UploadFile = File(...)):
    rows = await _read_tabular_upload(file)
    created, errors = 0, []
    for i, row in enumerate(rows, start=2):
        try:
            vendor = str(row.get("vendor") or "").strip()
            reference_no = str(row.get("reference_no") or "").strip()
            if not vendor or not reference_no:
                errors.append(f"Row {i}: vendor and reference_no are required")
                continue
            total_amount = float(row.get("total_amount", 0) or 0)
            paid_amount = float(row.get("paid_amount", 0) or 0)
            if total_amount < 0 or paid_amount < 0:
                errors.append(f"Row {i}: amounts cannot be negative")
                continue
            if paid_amount > total_amount:
                errors.append(f"Row {i}: paid amount cannot exceed total amount")
                continue
            payload = PayableCreate(
                vendor=vendor,
                reference_no=reference_no,
                source=str(row.get("source") or "Fabric Purchase").strip() or "Fabric Purchase",
                total_amount=total_amount,
                paid_amount=paid_amount,
                due_date=str(row.get("due_date") or "").strip() or None,
                notes=str(row.get("notes") or "").strip(),
            )
            await create_payable(payload)
            created += 1
        except Exception as e:
            errors.append(f"Row {i}: {e}")
    return {"created": created, "errors": errors}


@api_router.post("/import/receivables")
async def import_receivables(file: UploadFile = File(...)):
    rows = await _read_tabular_upload(file)
    created, errors = 0, []
    for i, row in enumerate(rows, start=2):
        try:
            customer = str(row.get("customer") or "").strip()
            invoice_no = str(row.get("invoice_no") or "").strip()
            if not customer or not invoice_no:
                errors.append(f"Row {i}: customer and invoice_no are required")
                continue
            total_amount = float(row.get("total_amount", 0) or 0)
            received_amount = float(row.get("received_amount", 0) or 0)
            if total_amount < 0 or received_amount < 0:
                errors.append(f"Row {i}: amounts cannot be negative")
                continue
            if received_amount > total_amount:
                errors.append(f"Row {i}: received amount cannot exceed total amount")
                continue
            payload = ReceivableCreate(
                customer=customer,
                invoice_no=invoice_no,
                total_amount=total_amount,
                received_amount=received_amount,
                due_date=str(row.get("due_date") or "").strip() or None,
                notes=str(row.get("notes") or "").strip(),
            )
            await create_receivable(payload)
            created += 1
        except Exception as e:
            errors.append(f"Row {i}: {e}")
    return {"created": created, "errors": errors}


@api_router.post("/import/payment-transactions")
async def import_payment_transactions(file: UploadFile = File(...)):
    rows = await _read_tabular_upload(file)
    created, errors = 0, []
    for i, row in enumerate(rows, start=2):
        try:
            payload = PaymentTransactionCreate(
                date=str(row.get("date") or "").strip() or None,
                transaction_type=str(row.get("transaction_type") or "").strip() or "Payment Given",
                party=str(row.get("party") or "").strip(),
                reference_no=str(row.get("reference_no") or "").strip(),
                amount=float(row.get("amount", 0) or 0),
                payment_mode=str(row.get("payment_mode") or "Cash").strip() or "Cash",
                notes=str(row.get("notes") or "").strip(),
            )
            if payload.amount < 0:
                errors.append(f"Row {i}: amounts cannot be negative")
                continue
            await create_payment_transaction(payload)
            created += 1
        except Exception as e:
            errors.append(f"Row {i}: {e}")
    return {"created": created, "errors": errors}


@api_router.get("/export/payables")
async def export_payables(include_archived: bool = False):
    rows = await _list(store.payables, include_archived)
    try:
        import pandas as pd
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Excel export dependency error: {e}")

    export_rows = [
        {
            "Vendor": row.get("vendor"),
            "Reference No": row.get("reference_no"),
            "Source": row.get("source"),
            "Total Amount": row.get("total_amount"),
            "Paid Amount": row.get("paid_amount"),
            "Balance Amount": row.get("balance_amount"),
            "Due Date": row.get("due_date"),
            "Status": row.get("status"),
            "Notes": row.get("notes"),
        }
        for row in rows
    ]
    df = pd.DataFrame(export_rows)
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Payables")
    buffer.seek(0)
    headers = {"Content-Disposition": "attachment; filename=payables.xlsx"}
    return StreamingResponse(buffer, headers=headers, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@api_router.get("/export/receivables")
async def export_receivables(include_archived: bool = False):
    rows = await _list(store.receivables, include_archived)
    try:
        import pandas as pd
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Excel export dependency error: {e}")

    export_rows = [
        {
            "Customer": row.get("customer"),
            "Invoice No": row.get("invoice_no"),
            "Total Amount": row.get("total_amount"),
            "Received Amount": row.get("received_amount"),
            "Balance Amount": row.get("balance_amount"),
            "Due Date": row.get("due_date"),
            "Status": row.get("status"),
            "Notes": row.get("notes"),
        }
        for row in rows
    ]
    df = pd.DataFrame(export_rows)
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Receivables")
    buffer.seek(0)
    headers = {"Content-Disposition": "attachment; filename=receivables.xlsx"}
    return StreamingResponse(buffer, headers=headers, media_type="application/vnd.openxmlformats-officedocument/spreadsheetml.sheet")


@api_router.get("/export/payment-transactions")
async def export_payment_transactions(include_archived: bool = False):
    rows = await _list(store.payment_transactions, include_archived)
    try:
        import pandas as pd
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Excel export dependency error: {e}")

    export_rows = [
        {
            "Date": row.get("date"),
            "Payment Type": row.get("transaction_type"),
            "Party": row.get("party"),
            "Reference No": row.get("reference_no"),
            "Amount": row.get("amount"),
            "Payment Mode": row.get("payment_mode"),
            "Notes": row.get("notes"),
        }
        for row in rows
    ]
    df = pd.DataFrame(export_rows)
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Transactions")
    buffer.seek(0)
    headers = {"Content-Disposition": "attachment; filename=payment_transactions.xlsx"}
    return StreamingResponse(buffer, headers=headers, media_type="application/vnd.openxmlformats-officedocument/spreadsheetml.sheet")


def _get_material_ledger_payload() -> Dict[str, Any]:
    with SessionLocal() as session:
        inventory_rows = [
            _serialize_row(MaterialInventoryORM, row)
            for row in session.query(MaterialInventoryORM).filter(
                MaterialInventoryORM.archived.isnot(True),
            ).order_by(MaterialInventoryORM.date.asc(), MaterialInventoryORM.created_at.asc()).all()
        ]
        dispatch_rows = [
            _serialize_row(MaterialDispatchORM, row)
            for row in session.query(MaterialDispatchORM).filter(
                MaterialDispatchORM.archived.isnot(True),
            ).order_by(MaterialDispatchORM.date.asc(), MaterialDispatchORM.created_at.asc()).all()
        ]
        payables = [
            _serialize_row(PayableORM, row)
            for row in session.query(PayableORM).filter(
                PayableORM.archived.isnot(True),
            ).all()
        ]
        receivables = [
            _serialize_row(ReceivableORM, row)
            for row in session.query(ReceivableORM).filter(
                ReceivableORM.archived.isnot(True),
            ).all()
        ]
    with SessionLocal() as lookup_session:
        vendor_lookup = {
            vendor.get("id"): vendor
            for vendor in [
                _serialize_row(VendorORM, row)
                for row in lookup_session.query(VendorORM).filter(VendorORM.archived.isnot(True)).all()
            ]
            if vendor.get("id")
        }
    return build_material_ledger(inventory_rows, dispatch_rows, payables, receivables, vendor_lookup)


@api_router.get("/material-ledger")
async def material_ledger():
    return _get_material_ledger_payload()


@api_router.get("/export/material-ledger")
async def export_material_ledger():
    ledger = _get_material_ledger_payload()
    rows = ledger.get("rows", [])
    export_rows = [
        {
            "Date": row.get("date"),
            "Transaction Type": row.get("transaction_type"),
            "Reference No.": row.get("reference_no"),
            "Supplier / Vendor": row.get("party"),
            "Material": row.get("material"),
            "Qty In": row.get("qty_in"),
            "Qty Out": row.get("qty_out"),
            "Balance": row.get("balance"),
            "Unit": row.get("unit"),
            "Rate": row.get("rate"),
            "Amount": row.get("amount"),
            "Payment Status": row.get("payment_status"),
        }
        for row in rows
    ]
    try:
        import pandas as pd
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Excel export dependency error: {e}")

    df = pd.DataFrame(export_rows)
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Material Ledger")
    buffer.seek(0)
    headers = {"Content-Disposition": "attachment; filename=material_ledger.xlsx"}
    return StreamingResponse(buffer, headers=headers, media_type="application/vnd.openxmlformats-officedocument/spreadsheetml.sheet")


# ============ MATERIAL DISPATCHES ============
@api_router.get("/material-dispatches", response_model=List[MaterialDispatch])
async def list_material_dispatches(include_archived: bool = False):
    return await _list(store.material_dispatches, include_archived)


@api_router.post("/material-dispatches", response_model=MaterialDispatch)
async def create_material_dispatch(payload: MaterialDispatchCreate):
    data = payload.model_dump()
    material_name = (data.get("material_name") or "").strip()
    unit = (data.get("unit") or "pcs").strip() or "pcs"
    quantity = float(data.get("quantity", 0) or 0)
    vendor_id = (data.get("vendor_id") or "").strip()
    requested_rate = data.get("rate")

    if not vendor_id:
        raise HTTPException(status_code=400, detail="Party / Company is required")
    if not material_name:
        raise HTTPException(status_code=400, detail="Material name is required")
    if quantity <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be greater than zero")

    dispatch_date = _coerce_dispatch_date(data.get("date"))

    with SessionLocal() as session:
        vendor = session.query(VendorORM).filter(
            VendorORM.id == vendor_id,
            VendorORM.archived.isnot(True),
        ).first()
        if vendor is None:
            raise HTTPException(status_code=400, detail="Selected party / company not found")

        dispatch_no = (data.get("dispatch_no") or "").strip() or _generate_dispatch_no(session, dispatch_date)
        if session.query(MaterialDispatchORM).filter(MaterialDispatchORM.dispatch_no == dispatch_no).first():
            raise HTTPException(status_code=400, detail="Dispatch number already exists")

        allocations = _allocate_material_stock(session, material_name, unit, quantity)
        row_payload = {
            "date": dispatch_date,
            "dispatch_no": dispatch_no,
            "vendor_id": vendor_id,
            "material_name": material_name,
            "quantity": round(quantity, 3),
            "unit": unit,
            "purpose": (data.get("purpose") or "").strip(),
            "status": (data.get("status") or "Dispatched").strip() or "Dispatched",
            "notes": (data.get("notes") or "").strip(),
            "allocation_json": json.dumps(allocations),
            "archived": False,
        }
        row = _make_row_from_doc(MaterialDispatchORM, row_payload)
        session.add(row)
        session.commit()
        session.refresh(row)
        rate = float(requested_rate) if requested_rate is not None else _material_dispatch_rate(session, allocations)
        amount = round(float(quantity) * float(rate or 0.0), 2)
        _upsert_material_receivable(session, row, amount, vendor.name)
        _upsert_material_adjustment(session, row, amount)
        session.commit()
        session.refresh(row)
        return _serialize_row(MaterialDispatchORM, row)


@api_router.patch("/material-dispatches/{item_id}", response_model=MaterialDispatch)
async def update_material_dispatch(item_id: str, updates: Dict[str, Any]):
    with SessionLocal() as session:
        row = session.query(MaterialDispatchORM).filter(MaterialDispatchORM.id == item_id).first()
        if row is None:
            raise HTTPException(status_code=404, detail="Not found")

        old_allocations = _parse_allocations(row.allocation_json)

        try:
            _restore_material_stock(session, old_allocations)

            next_vendor_id = (updates.get("vendor_id") if "vendor_id" in updates else row.vendor_id) or ""
            next_material_name = (updates.get("material_name") if "material_name" in updates else row.material_name) or ""
            next_unit = (updates.get("unit") if "unit" in updates else row.unit) or "pcs"
            next_quantity = float(updates.get("quantity") if "quantity" in updates else row.quantity)
            next_purpose = (updates.get("purpose") if "purpose" in updates else row.purpose) or ""
            next_notes = (updates.get("notes") if "notes" in updates else row.notes) or ""
            next_status = (updates.get("status") if "status" in updates else row.status) or "Dispatched"
            next_dispatch_no = (updates.get("dispatch_no") if "dispatch_no" in updates else row.dispatch_no) or row.dispatch_no

            next_material_name = str(next_material_name).strip()
            next_unit = str(next_unit).strip() or "pcs"
            next_vendor_id = str(next_vendor_id).strip()
            next_dispatch_no = str(next_dispatch_no).strip()

            if not next_vendor_id:
                raise HTTPException(status_code=400, detail="Party / Company is required")
            if not next_material_name:
                raise HTTPException(status_code=400, detail="Material name is required")
            if next_quantity <= 0:
                raise HTTPException(status_code=400, detail="Quantity must be greater than zero")

            vendor = session.query(VendorORM).filter(
                VendorORM.id == next_vendor_id,
                VendorORM.archived.isnot(True),
            ).first()
            if vendor is None:
                raise HTTPException(status_code=400, detail="Selected party / company not found")

            duplicate = session.query(MaterialDispatchORM).filter(
                MaterialDispatchORM.dispatch_no == next_dispatch_no,
                MaterialDispatchORM.id != row.id,
            ).first()
            if duplicate:
                raise HTTPException(status_code=400, detail="Dispatch number already exists")

            allocations = _allocate_material_stock(session, next_material_name, next_unit, float(next_quantity))

            if "date" in updates:
                row.date = _coerce_dispatch_date(updates.get("date"))
            row.dispatch_no = next_dispatch_no
            row.vendor_id = next_vendor_id
            row.material_name = next_material_name
            row.quantity = round(float(next_quantity), 3)
            row.unit = next_unit
            row.purpose = str(next_purpose).strip()
            row.status = str(next_status).strip() or "Dispatched"
            row.notes = str(next_notes).strip()
            row.allocation_json = json.dumps(allocations)

            requested_rate = updates.get("rate")
            if requested_rate is None:
                requested_rate = _material_dispatch_rate(session, allocations)
            else:
                requested_rate = float(requested_rate)
            amount = round(float(next_quantity) * float(requested_rate or 0.0), 2)
            _upsert_material_receivable(session, row, amount, vendor.name)
            _upsert_material_adjustment(session, row, amount)

            session.commit()
            session.refresh(row)
            return _serialize_row(MaterialDispatchORM, row)
        except HTTPException:
            session.rollback()
            raise
        except Exception:
            session.rollback()
            raise


@api_router.delete("/material-dispatches/{item_id}")
async def delete_material_dispatch(item_id: str):
    with SessionLocal() as session:
        row = session.query(MaterialDispatchORM).filter(MaterialDispatchORM.id == item_id).first()
        if row is None:
            return {"ok": True}

        allocations = _parse_allocations(row.allocation_json)
        _restore_material_stock(session, allocations)
        _archive_party_ledger_entries_for_source(session, "material_dispatch", row.id)
        session.delete(row)
        session.commit()
    return {"ok": True}


# ============ FABRIC DISPATCHES ============
@api_router.get("/fabric-dispatches", response_model=List[FabricDispatch])
async def list_fabric_dispatches(include_archived: bool = False):
    return await _list(store.fabric_dispatches, include_archived)


@api_router.post("/fabric-dispatches", response_model=FabricDispatch)
async def create_fabric_dispatch(payload: FabricDispatchCreate):
    lot = await _get(store.fabric_lots, payload.fabric_lot_id)
    with SessionLocal() as session:
        total_dispatched = session.query(func.sum(FabricDispatchORM.kg_dispatched)).filter(
            FabricDispatchORM.fabric_lot_id == lot["id"],
            FabricDispatchORM.archived.isnot(True),
        ).scalar() or 0.0
    remaining = lot["kg_received"] - total_dispatched
    if payload.kg_dispatched > remaining + 0.001:
        raise HTTPException(status_code=400,
                            detail=f"Only {remaining:.3f} kg remaining in this lot")
    data = payload.model_dump()
    if not data.get("date"):
        data["date"] = now_iso()
    expected_pieces = _coerce_number(data.get("expected_pieces"), 0.0)
    if expected_pieces <= 0:
        expected_pieces = _coerce_number(_normalize_dispatch_note_payload(data.get("notes") or "").get("expectedPieces") or _normalize_dispatch_note_payload(data.get("notes") or "").get("expected_pieces"), 0.0)
    data["expected_pieces"] = expected_pieces
    if data.get("notes"):
        data["notes"] = _update_dispatch_note_payload(str(data.get("notes") or ""), expectedPieces=expected_pieces)
    obj = FabricDispatch(**data)
    created = await _create(store.fabric_dispatches, obj.model_dump())
    with SessionLocal() as session:
        dispatch_row = session.query(FabricDispatchORM).filter(FabricDispatchORM.id == created.get("id")).first()
        if dispatch_row is not None:
            dispatch_row.expected_pieces = expected_pieces
            if data.get("notes"):
                dispatch_row.notes = data["notes"]
            vendor_name = ""
            if dispatch_row.vendor_id:
                vendor = session.query(VendorORM).filter(VendorORM.id == dispatch_row.vendor_id).first()
                vendor_name = vendor.name if vendor is not None else ""
            _upsert_fabric_receivable(session, dispatch_row, _fabric_dispatch_receivable_amount(session, dispatch_row), vendor_name or dispatch_row.vendor_id or "Unknown Vendor")
            session.commit()
    return obj


@api_router.patch("/fabric-dispatches/{item_id}", response_model=FabricDispatch)
async def update_fabric_dispatch(item_id: str, updates: Dict[str, Any]):
    next_expected_pieces = _coerce_number(updates.get("expected_pieces"), 0.0)
    if next_expected_pieces <= 0 and "notes" in updates:
        parsed_notes = _normalize_dispatch_note_payload(str(updates.get("notes") or ""))
        next_expected_pieces = _coerce_number(parsed_notes.get("expectedPieces") or parsed_notes.get("expected_pieces"), 0.0)
    if next_expected_pieces > 0:
        updates = {**updates, "expected_pieces": next_expected_pieces}
    if "notes" in updates and updates.get("notes") is not None:
        updates = {**updates, "notes": _update_dispatch_note_payload(str(updates.get("notes") or ""), expectedPieces=next_expected_pieces)}
    updated = await _update(store.fabric_dispatches, item_id, updates,
                         ["fabric_lot_id", "vendor_id", "order_id", "product_type_id", "kg_dispatched", "expected_pieces", "date", "notes"])
    with SessionLocal() as session:
        dispatch_row = session.query(FabricDispatchORM).filter(FabricDispatchORM.id == item_id).first()
        if dispatch_row is not None:
            dispatch_row.expected_pieces = _coerce_number(updated.get("expected_pieces"), 0.0)
            if "notes" in updates:
                dispatch_row.notes = updates["notes"]
            vendor_name = ""
            if dispatch_row.vendor_id:
                vendor = session.query(VendorORM).filter(VendorORM.id == dispatch_row.vendor_id).first()
                vendor_name = vendor.name if vendor is not None else ""
            _upsert_fabric_receivable(session, dispatch_row, _fabric_dispatch_receivable_amount(session, dispatch_row), vendor_name or dispatch_row.vendor_id or "Unknown Vendor")
            session.commit()
    return updated


@api_router.patch("/fabric-dispatches/{item_id}/archive")
async def archive_fabric_dispatch(item_id: str, payload: ArchivePayload):
    return await _update(store.fabric_dispatches, item_id, {"archived": payload.archived}, ["archived"])


@api_router.delete("/fabric-dispatches/{item_id}")
async def delete_fabric_dispatch(item_id: str):
    await _delete(store.fabric_dispatches, item_id)
    return {"ok": True}


def _serialize_order_item(row: OrderItemORM) -> Dict[str, Any]:
    return {
        "id": row.id,
        "product_type": row.product_type,
        "description": row.description,
        "brand": row.brand,
        "article_number": row.article_number,
        "color": row.color,
        "size": row.size,
        "fabric": row.fabric,
        "gsm": row.gsm,
        "quantity": row.quantity,
        "unit_price": row.unit_price,
        "amount": row.amount,
        "remarks": row.remarks,
        "archived": row.archived,
    }


def _serialize_order(row: OrderORM) -> Dict[str, Any]:
    return {
        "id": row.id,
        "order_number": row.order_number,
        "buyer_id": row.buyer_id,
        "product_type_id": row.product_type_id,
        "quantity": row.quantity,
        "unit_price": row.unit_price,
        "stage": row.stage,
        "order_status": row.order_status,
        "order_type": row.order_type,
        "payment_terms": row.payment_terms,
        "currency": row.currency,
        "subtotal": row.subtotal,
        "discount": row.discount,
        "tax": row.tax,
        "grand_total": row.grand_total,
        "order_date": row.order_date.isoformat() if row.order_date else "",
        "delivery_date": row.delivery_date.isoformat() if row.delivery_date else None,
        "notes": row.notes,
        "items": [],
        "total_product_types": 0,
        "total_pieces": 0,
        "archived": row.archived,
        "created_at": row.created_at.isoformat() if row.created_at else "",
    }


def _resolve_order_quantity(items: Optional[List[Dict[str, Any]]] = None, fallback: Any = 0) -> int:
    if items:
        item_total = sum(int(item.get("quantity", 0) or 0) for item in items if isinstance(item, dict))
        if item_total > 0:
            return item_total
    return int(fallback or 0)


# ============ ORDERS ============
@api_router.get("/orders", response_model=List[Order])
async def list_orders(include_archived: bool = False):
    with SessionLocal() as session:
        query = session.query(OrderORM)
        if not include_archived:
            query = query.filter(OrderORM.archived.is_(False))
        rows = query.order_by(OrderORM.created_at.desc()).all()
        orders = []
        for row in rows:
            payload = _serialize_order(row)
            item_rows = session.query(OrderItemORM).filter(OrderItemORM.order_id == row.id, OrderItemORM.archived.is_(False)).order_by(OrderItemORM.created_at.asc()).all()
            payload["items"] = [_serialize_order_item(item_row) for item_row in item_rows]
            payload["total_product_types"] = len(payload["items"])
            payload["total_pieces"] = sum(int(item.get("quantity", 0) or 0) for item in payload["items"])
            orders.append(payload)
        return orders


@api_router.get("/orders/stages")
async def get_stages():
    return {"stages": PRODUCTION_STAGES}


@api_router.post("/orders", response_model=Order)
async def create_order(payload: OrderCreate):
    data = payload.model_dump()
    if not data.get("order_date"):
        data["order_date"] = now_iso()
    items = data.pop("items", []) or []
    order_quantity = _resolve_order_quantity(items, data.get("quantity", 0))
    order_row = OrderORM(
        company_id=_current_company_id(),
        order_number=data.get("order_number"),
        buyer_id=data.get("buyer_id"),
        product_type_id=data.get("product_type_id"),
        quantity=order_quantity,
        unit_price=float(data.get("unit_price", 0) or 0),
        stage=data.get("stage", "order_received"),
        order_status=data.get("order_status", "Confirmed"),
        order_type=data.get("order_type", "local"),
        payment_terms=data.get("payment_terms", ""),
        currency=data.get("currency", "INR"),
        subtotal=float(data.get("subtotal", 0) or 0),
        discount=float(data.get("discount", 0) or 0),
        tax=float(data.get("tax", 0) or 0),
        grand_total=float(data.get("grand_total", 0) or 0),
        order_date=data.get("order_date") and datetime.fromisoformat(data["order_date"]) or now_utc(),
        delivery_date=data.get("delivery_date") and datetime.fromisoformat(data["delivery_date"]) or None,
        notes=data.get("notes", ""),
        archived=False,
    )
    with SessionLocal() as session:
        session.add(order_row)
        session.flush()
        if items:
            for item in items:
                item_amount = float(item.get("unit_price", 0) or 0) * int(item.get("quantity", 0) or 0)
                session.add(OrderItemORM(
                    company_id=_current_company_id(),
                    order_id=order_row.id,
                    product_type=item.get("product_type", ""),
                    description=item.get("description", ""),
                    brand=item.get("brand", ""),
                    article_number=item.get("article_number", ""),
                    color=item.get("color", ""),
                    size=item.get("size", ""),
                    fabric=item.get("fabric", ""),
                    gsm=item.get("gsm", ""),
                    quantity=int(item.get("quantity", 0) or 0),
                    unit_price=float(item.get("unit_price", 0) or 0),
                    amount=item_amount,
                    remarks=item.get("remarks", ""),
                    archived=False,
                ))
        if not order_row.subtotal:
            order_row.subtotal = sum(float(item.get("unit_price", 0) or 0) * int(item.get("quantity", 0) or 0) for item in items)
        if not order_row.grand_total:
            order_row.grand_total = order_row.subtotal + order_row.tax - order_row.discount
        session.commit()
        session.refresh(order_row)
        payload = _serialize_order(order_row)
        item_rows = session.query(OrderItemORM).filter(OrderItemORM.order_id == order_row.id, OrderItemORM.archived.is_(False)).order_by(OrderItemORM.created_at.asc()).all()
        payload["items"] = [_serialize_order_item(item_row) for item_row in item_rows]
        payload["total_product_types"] = len(payload["items"])
        payload["total_pieces"] = sum(int(item.get("quantity", 0) or 0) for item in payload["items"])
        return payload


@api_router.patch("/orders/{item_id}", response_model=Order)
async def update_order(item_id: str, updates: Dict[str, Any]):
    item_updates = dict(updates)
    items = item_updates.pop("items", None)
    if items is not None:
        with SessionLocal() as session:
            existing_items = session.query(OrderItemORM).filter(OrderItemORM.order_id == item_id).all()
            for existing in existing_items:
                existing.archived = True
            for item in items:
                line_amount = float(item.get("unit_price", 0) or 0) * int(item.get("quantity", 0) or 0)
                session.add(OrderItemORM(
                    company_id=_current_company_id(),
                    order_id=item_id,
                    product_type=item.get("product_type", ""),
                    description=item.get("description", ""),
                    brand=item.get("brand", ""),
                    article_number=item.get("article_number", ""),
                    color=item.get("color", ""),
                    size=item.get("size", ""),
                    fabric=item.get("fabric", ""),
                    gsm=item.get("gsm", ""),
                    quantity=int(item.get("quantity", 0) or 0),
                    unit_price=float(item.get("unit_price", 0) or 0),
                    amount=line_amount,
                    remarks=item.get("remarks", ""),
                    archived=False,
                ))
            session.commit()
    if item_updates:
        with SessionLocal() as session:
            order_row = session.query(OrderORM).filter(OrderORM.id == item_id).first()
            if order_row is None:
                raise HTTPException(status_code=404, detail="order not found")
            for field in ["order_number", "buyer_id", "product_type_id", "quantity", "unit_price", "stage", "order_status", "order_type", "payment_terms", "currency", "subtotal", "discount", "tax", "grand_total", "notes"]:
                if field in item_updates:
                    setattr(order_row, field, item_updates[field])
            if "order_date" in item_updates and item_updates["order_date"]:
                order_row.order_date = datetime.fromisoformat(item_updates["order_date"])
            if "delivery_date" in item_updates and item_updates["delivery_date"]:
                order_row.delivery_date = datetime.fromisoformat(item_updates["delivery_date"])
            if items is not None:
                order_row.quantity = _resolve_order_quantity(items, item_updates.get("quantity", order_row.quantity))
            elif "quantity" in item_updates:
                order_row.quantity = int(item_updates.get("quantity", 0) or 0)
            if not order_row.subtotal and items is not None:
                order_row.subtotal = sum(float(item.get("unit_price", 0) or 0) * int(item.get("quantity", 0) or 0) for item in items)
            if not order_row.grand_total:
                order_row.grand_total = order_row.subtotal + order_row.tax - order_row.discount
            session.commit()
            session.refresh(order_row)
            payload = _serialize_order(order_row)
            item_rows = session.query(OrderItemORM).filter(OrderItemORM.order_id == item_id, OrderItemORM.archived.is_(False)).order_by(OrderItemORM.created_at.asc()).all()
            payload["items"] = [_serialize_order_item(item_row) for item_row in item_rows]
            payload["total_product_types"] = len(payload["items"])
            payload["total_pieces"] = sum(int(item.get("quantity", 0) or 0) for item in payload["items"])
            return payload
    with SessionLocal() as session:
        order_row = session.query(OrderORM).filter(OrderORM.id == item_id).first()
        if order_row is None:
            raise HTTPException(status_code=404, detail="order not found")
        payload = _serialize_order(order_row)
        item_rows = session.query(OrderItemORM).filter(OrderItemORM.order_id == item_id, OrderItemORM.archived.is_(False)).order_by(OrderItemORM.created_at.asc()).all()
        payload["items"] = [_serialize_order_item(item_row) for item_row in item_rows]
        payload["total_product_types"] = len(payload["items"])
        payload["total_pieces"] = sum(int(item.get("quantity", 0) or 0) for item in payload["items"])
        return payload


@api_router.patch("/orders/{item_id}/archive")
async def archive_order(item_id: str, payload: ArchivePayload):
    return await _update(store.orders, item_id, {"archived": payload.archived}, ["archived"])


@api_router.patch("/orders/{item_id}/stage", response_model=Order)
async def update_order_stage(item_id: str, payload: OrderStageUpdate):
    if payload.stage not in PRODUCTION_STAGES:
        raise HTTPException(status_code=400, detail="Invalid stage")
    updated = await _update(store.orders, item_id, {"stage": payload.stage}, ["stage"])
    if payload.stage == "shipment":
        with SessionLocal() as session:
            order_row = session.query(OrderORM).filter(OrderORM.id == item_id).first()
            if order_row is not None:
                buyer = session.query(BuyerORM).filter(BuyerORM.id == order_row.buyer_id).first()
                party = _resolve_party_from_name(session, buyer.name if buyer is not None else "", "Customer")
                if party is not None:
                    _upsert_party_ledger_entry(
                        session,
                        party,
                        order_row.order_date or now_utc(),
                        "Shipment",
                        order_row.order_number or order_row.id,
                        "Shipment",
                        0.0,
                        0.0,
                        "Shipment",
                        "order_stage",
                        order_row.id,
                        "Shipment",
                    )
                session.commit()
    return updated


@api_router.delete("/orders/{item_id}")
async def delete_order(item_id: str):
    await _delete(store.orders, item_id)
    return {"ok": True}


@api_router.get("/shipments", response_model=List[Shipment])
async def list_shipments(search: Optional[str] = None):
    with SessionLocal() as session:
        query = session.query(ShipmentORM).filter(ShipmentORM.company_id == _current_company_id())
        if search:
            like = f"%{search.lower()}%"
            query = query.filter(
                func.lower(ShipmentORM.shipment_no).like(like)
                | func.lower(ShipmentORM.customer).like(like)
            )
        rows = query.order_by(ShipmentORM.created_at.desc()).all()
        shipments = []
        for row in rows:
            shipment = _serialize_row(ShipmentORM, row)
            product_rows = session.query(ShipmentProductORM).filter(
                ShipmentProductORM.shipment_id == row.id,
                ShipmentProductORM.company_id == _current_company_id(),
            ).order_by(ShipmentProductORM.created_at.asc()).all()
            shipment["products"] = [_serialize_row(ShipmentProductORM, product_row) for product_row in product_rows]
            shipments.append(shipment)
        return shipments


def _shipment_receivable_amount(product_rows) -> float:
    return round(sum(float((product.dispatch_quantity or 0) or 0) * 100.0 for product in product_rows), 2)


def _upsert_shipment_receivable(session, shipment_row: ShipmentORM, product_rows) -> ReceivableORM:
    note_token = f"shipment_id:{shipment_row.id}"
    customer_name = (shipment_row.customer or "").strip() or "Unknown Customer"
    invoice_no = (shipment_row.invoice_no or "").strip() or f"INV-{shipment_row.shipment_no or shipment_row.id}"
    total_amount = _shipment_receivable_amount(product_rows)

    existing = session.query(ReceivableORM).filter(
        ReceivableORM.company_id == _current_company_id(),
        ReceivableORM.notes.like(f"%{note_token}%"),
        ReceivableORM.archived.isnot(True),
    ).first()
    if existing is None:
        existing = session.query(ReceivableORM).filter(
            ReceivableORM.company_id == _current_company_id(),
            ReceivableORM.invoice_no == invoice_no,
            ReceivableORM.archived.isnot(True),
        ).first()

    existing_notes = existing.notes or "" if existing else ""
    note_text = existing_notes or ""
    if note_token not in note_text:
        note_text = f"{note_text} | {note_token}".strip(" |") if note_text else note_token

    if existing is not None:
        existing.customer = customer_name
        existing.invoice_no = invoice_no
        existing.total_amount = total_amount
        existing.balance_amount = round(max(total_amount - float(existing.received_amount or 0), 0), 2)
        existing.status = _payment_status(total_amount, float(existing.received_amount or 0))
        existing.notes = note_text
        session.flush()
        return existing

    receivable = ReceivableORM(
        company_id=_current_company_id(),
        customer=customer_name,
        invoice_no=invoice_no,
        total_amount=total_amount,
        received_amount=0.0,
        balance_amount=round(total_amount, 2),
        status=_payment_status(total_amount, 0.0),
        notes=note_text,
    )
    session.add(receivable)
    session.flush()
    return receivable


def _warehouse_availability_for_line(session, *, product_type_id: str, article_number: str = "", brand: str = "") -> Dict[str, Any]:
    normalized_article = (article_number or "").strip().lower()
    normalized_brand = (brand or "").strip().lower()
    product_type_id = (product_type_id or "").strip()

    query = session.query(ProductionReturnORM).filter(
        ProductionReturnORM.company_id == _current_company_id(),
        ProductionReturnORM.archived.isnot(True),
    )
    if product_type_id:
        query = query.filter(ProductionReturnORM.product_type_id == product_type_id)
    return_rows = query.order_by(ProductionReturnORM.date.asc(), ProductionReturnORM.created_at.asc()).all()

    matched_returns = []
    for row in return_rows:
        note_data = _unpack_return_notes(row.notes or "")
        article_value = (note_data.get("article_barcode") or "").strip().lower()
        article_match = True
        if normalized_article:
            article_match = (
                article_value == normalized_article
                or (note_data.get("challan_no") or "").strip().lower() == normalized_article
                or (note_data.get("lot_no") or "").strip().lower() == normalized_article
                or normalized_article in (row.notes or "").lower()
            )
        if not article_match:
            continue
        if normalized_brand:
            dispatch_id = (row.order_id or "").strip()
            dispatch_row = None
            if dispatch_id:
                dispatch_row = session.query(FabricDispatchORM).filter(
                    FabricDispatchORM.id == dispatch_id,
                    FabricDispatchORM.company_id == _current_company_id(),
                    FabricDispatchORM.archived.isnot(True),
                ).first()
            dispatch_brand = ""
            if dispatch_row is not None:
                dispatch_brand = ( _parse_dispatch_note_blob(dispatch_row.notes or "").get("brand_name") or "").strip().lower()
            if dispatch_brand and dispatch_brand != normalized_brand:
                continue
        matched_returns.append(row)

    shipped_total = 0
    for shipment_row in session.query(ShipmentProductORM).filter(
        ShipmentProductORM.company_id == _current_company_id(),
        ShipmentProductORM.archived.isnot(True),
    ).all():
        if product_type_id and (shipment_row.product_type_id or "").strip() != product_type_id:
            continue
        if normalized_article and (shipment_row.article_number or "").strip().lower() != normalized_article:
            continue
        if normalized_brand and (shipment_row.brand or "").strip().lower() != normalized_brand:
            continue
        shipped_total += int(shipment_row.dispatch_quantity or 0)

    received_total = sum(int(row.pieces_received or 0) for row in matched_returns)
    return {
        "return_rows": matched_returns,
        "available_stock": max(received_total - shipped_total, 0),
    }


@api_router.post("/shipments", response_model=Shipment)
async def create_shipment(payload: ShipmentCreate):
    shipment_no = (payload.shipment_no or "").strip()
    if not shipment_no:
        shipment_no = f"SH-{datetime.now().strftime('%Y%m%d%H%M%S')}"

    with SessionLocal() as session:
        existing = session.query(ShipmentORM).filter(
            ShipmentORM.company_id == _current_company_id(),
            ShipmentORM.shipment_no == shipment_no,
            ShipmentORM.archived.isnot(True),
        ).first()
        if existing is not None:
            raise HTTPException(status_code=400, detail="Duplicate shipment number")

        order_row = None
        order_id = (payload.order_id or "").strip()
        order_number = (payload.order_number or "").strip()
        if order_id or order_number:
            query = session.query(OrderORM).filter(OrderORM.company_id == _current_company_id(), OrderORM.archived.isnot(True))
            if order_id:
                query = query.filter(OrderORM.id == order_id)
            else:
                query = query.filter(OrderORM.order_number == order_number)
            order_row = query.first()
            if order_row is None:
                raise HTTPException(status_code=400, detail="Selected order was not found")

        shipment_date = datetime.fromisoformat((payload.shipment_date or now_iso()).replace("Z", "+00:00")) if payload.shipment_date else datetime.now(timezone.utc)
        customer_name = (payload.customer or "").strip()
        buyer_name = ""
        if order_row is not None:
            buyer = session.query(BuyerORM).filter(BuyerORM.id == order_row.buyer_id).first()
            buyer_name = buyer.name if buyer is not None else ""
            if not customer_name:
                customer_name = buyer_name

        shipment_row = ShipmentORM(
            company_id=_current_company_id(),
            shipment_no=shipment_no,
            shipment_date=shipment_date,
            order_id=order_row.id if order_row is not None else "",
            order_number=order_row.order_number if order_row is not None else order_number,
            buyer_name=buyer_name,
            brand="",
            order_date=order_row.order_date if order_row is not None else None,
            delivery_date=order_row.delivery_date if order_row is not None else None,
            order_quantity=order_row.quantity if order_row is not None else 0,
            warehouse_available_quantity=0,
            customer=customer_name,
            invoice_no=(payload.invoice_no or "").strip(),
            transport=(payload.transport or "").strip(),
            vehicle_no=(payload.vehicle_no or "").strip(),
            lr_no=(payload.lr_no or "").strip(),
            destination=(payload.destination or "").strip(),
            driver_name=(payload.driver_name or "").strip(),
            e_way_bill=(payload.e_way_bill or "").strip(),
            remarks=(payload.remarks or "").strip(),
            status="Completed",
        )
        session.add(shipment_row)
        session.flush()

        product_rows = []
        total_dispatch_qty = 0
        for product in payload.products:
            qty = int(product.dispatch_quantity or 0)
            if qty < 0:
                raise HTTPException(status_code=400, detail="Dispatch quantity cannot be negative")
            if qty == 0:
                continue
            product_type_id = (product.product_type_id or "").strip()
            article_number = (product.article_number or "").strip()
            available = int(product.available_pieces or 0)
            if qty > available:
                raise HTTPException(status_code=400, detail="Dispatch quantity cannot exceed warehouse availability")

            warehouse_context = _warehouse_availability_for_line(
                session,
                product_type_id=product_type_id,
                article_number=article_number,
                brand=(product.brand or "").strip(),
            )
            available_stock = int(warehouse_context.get("available_stock") or 0)
            if warehouse_context.get("return_rows"):
                available_stock = int(warehouse_context.get("available_stock") or 0)
            else:
                available_stock = max(int(available or 0), int(warehouse_context.get("available_stock") or 0))
            if qty > available_stock:
                raise HTTPException(status_code=400, detail="Warehouse stock is insufficient for the requested dispatch")

            product_row = ShipmentProductORM(
                company_id=_current_company_id(),
                shipment_id=shipment_row.id,
                order_id=order_row.id if order_row is not None else "",
                order_number=order_row.order_number if order_row is not None else order_number,
                article_number=article_number,
                brand=(product.brand or "").strip(),
                product_type_id=product_type_id,
                product_type_name=(product.product_type_name or "").strip(),
                size=(product.size or "").strip(),
                available_pieces=available_stock,
                warehouse_available_quantity=available_stock,
                dispatch_quantity=qty,
                unit=(product.unit or "pcs").strip(),
            )
            product_row.product_name = (product.product_name or product.product_type_name or "").strip()
            product_row.color = (product.color or "").strip()
            product_row.size = (product.size or "").strip()
            session.add(product_row)
            session.flush()
            product_rows.append(product_row)
            total_dispatch_qty += qty

        if not product_rows:
            raise HTTPException(status_code=400, detail="At least one shipment line is required")

        shipment_row.warehouse_available_quantity = total_dispatch_qty
        shipment_row.order_quantity = order_row.quantity if order_row is not None else 0
        shipment_row.brand = ""

        receivable_row = _upsert_shipment_receivable(session, shipment_row, product_rows)
        party = _resolve_party_from_name(session, shipment_row.customer or "", "Customer")
        if party is not None:
            _upsert_party_ledger_entry(
                session,
                party,
                shipment_row.shipment_date or now_utc(),
                "Shipment",
                receivable_row.invoice_no or shipment_row.shipment_no,
                "Shipment receivable",
                0.0,
                round(float(receivable_row.total_amount or 0.0), 2),
                "Shipment",
                "shipment",
                shipment_row.id,
                "Receipt",
            )

        session.commit()
        session.refresh(shipment_row)
        shipment = _serialize_row(ShipmentORM, shipment_row)
        product_rows = session.query(ShipmentProductORM).filter(
            ShipmentProductORM.shipment_id == shipment_row.id,
            ShipmentProductORM.company_id == _current_company_id(),
        ).all()
        shipment["products"] = [_serialize_row(ShipmentProductORM, product_row) for product_row in product_rows]
        shipment["total_dispatch_qty"] = total_dispatch_qty
        return shipment


def _note_value(text: str, label: str) -> str:
    if not text:
        return ""
    for part in re.split(r"[|;]", text):
        if ":" not in part:
            continue
        key, value = part.split(":", 1)
        if key.strip().lower() == label.lower():
            return value.strip()
    match = re.search(rf"(?i)\b{re.escape(label)}\b\s*[:=-]\s*([^|;]+)", text)
    if match:
        return match.group(1).strip()
    return ""


@api_router.get("/warehouse")
async def warehouse_stock(request: Request):
    with SessionLocal() as session:
        return_rows = session.query(ProductionReturnORM).filter(
            ProductionReturnORM.company_id == _current_company_id(),
            ProductionReturnORM.archived.isnot(True),
        ).order_by(ProductionReturnORM.date.asc(), ProductionReturnORM.created_at.asc()).all()
        shipped_products = session.query(ShipmentProductORM).filter(
            ShipmentProductORM.company_id == _current_company_id(),
            ShipmentProductORM.archived.isnot(True),
        ).all()
        order_rows = session.query(OrderORM).filter(
            OrderORM.company_id == _current_company_id(),
            OrderORM.archived.isnot(True),
            OrderORM.stage == "shipment",
        ).all()
        dispatch_rows = session.query(FabricDispatchORM).filter(
            FabricDispatchORM.company_id == _current_company_id(),
            FabricDispatchORM.archived.isnot(True),
        ).all()
        product_type_rows = session.query(ProductTypeORM).filter(
            ProductTypeORM.company_id == _current_company_id(),
            ProductTypeORM.archived.isnot(True),
        ).all()
        lot_rows = session.query(FabricLotORM).filter(
            FabricLotORM.company_id == _current_company_id(),
            FabricLotORM.archived.isnot(True),
        ).all()

    dispatch_map = {row.id: row for row in dispatch_rows if getattr(row, "id", "")}
    product_type_map = {row.id: row for row in product_type_rows if getattr(row, "id", "")}
    lot_map = {row.id: row for row in lot_rows if getattr(row, "id", "")}

    shipped_by_key: Dict[tuple, int] = {}
    for row in shipped_products:
        key = (
            (row.article_number or "").strip(),
            (row.product_type_id or "").strip(),
            (row.brand or "").strip(),
        )
        shipped_by_key[key] = shipped_by_key.get(key, 0) + int(row.dispatch_quantity or 0)

    reserved_by_product_type: Dict[str, int] = {}
    for row in order_rows:
        product_type_id = (row.product_type_id or "").strip()
        if product_type_id:
            reserved_by_product_type[product_type_id] = reserved_by_product_type.get(product_type_id, 0) + int(row.quantity or 0)

    grouped: Dict[tuple, Dict[str, Any]] = {}
    for row in return_rows:
        note_data = _unpack_return_notes(row.notes or "")
        article_number = (note_data.get("article_barcode") or "").strip() or (note_data.get("challan_no") or "").strip() or (note_data.get("lot_no") or "").strip()
        if not article_number:
            article_number = f"{row.product_type_id or 'unknown'}-{row.id[:8]}"

        dispatch_row = dispatch_map.get((row.order_id or "").strip())
        parsed_dispatch = _parse_dispatch_note_blob(dispatch_row.notes or "") if dispatch_row is not None else {}
        product_type = product_type_map.get(row.product_type_id or "") or {}
        product_name = (parsed_dispatch.get("product_type_name") or getattr(product_type, "name", "") or "Unknown").strip()
        product_type_name = (parsed_dispatch.get("product_type_name") or getattr(product_type, "name", "") or "Unknown").strip()
        brand = (parsed_dispatch.get("brand_name") or _note_value(row.notes or "", "Brand") or "").strip() or "Unspecified"
        warehouse_location = _note_value(row.notes or "", "Warehouse Location") or "Primary"
        colour = ""
        if dispatch_row is not None and getattr(dispatch_row, "fabric_lot_id", "") and dispatch_row.fabric_lot_id in lot_map:
            colour = str(getattr(lot_map[dispatch_row.fabric_lot_id], "color", "") or "")
        size = ""
        last_updated = row.date or (dispatch_row.date if dispatch_row is not None else None) or row.created_at
        key = (article_number, row.product_type_id or "", brand, warehouse_location)
        entry = grouped.setdefault(key, {
            "article_number": article_number,
            "brand": brand,
            "product_name": product_name,
            "product_type_id": row.product_type_id or "",
            "product_type_name": product_type_name,
            "colour": colour,
            "color": colour,
            "size": size,
            "pieces_received": 0,
            "pieces_shipped": 0,
            "pieces_reserved": 0,
            "pieces_available": 0,
            "warehouse_location": warehouse_location,
            "vendor_id": row.vendor_id or "",
            "dispatch_id": row.order_id or "",
            "status": "Available",
            "last_updated": last_updated,
        })
        entry["pieces_received"] += int(row.pieces_received or 0)
        if entry.get("last_updated") is None or (last_updated and str(last_updated) > str(entry.get("last_updated") or "")):
            entry["last_updated"] = last_updated

    for entry in grouped.values():
        key = (
            entry["article_number"],
            entry["product_type_id"],
            entry["brand"],
        )
        entry["pieces_shipped"] = shipped_by_key.get(key, 0)
        entry["pieces_reserved"] = reserved_by_product_type.get(entry["product_type_id"], 0)
        entry["pieces_available"] = max(int(entry["pieces_received"]) - int(entry["pieces_shipped"]) - int(entry["pieces_reserved"]), 0)
        if entry["pieces_available"] <= 0:
            entry["status"] = "Out of Stock"
        elif entry["pieces_shipped"] > 0 or entry["pieces_reserved"] > 0:
            entry["status"] = "Reserved"
        elif entry["pieces_available"] <= 5:
            entry["status"] = "Low Stock"
        else:
            entry["status"] = "Available"

    items = list(grouped.values())
    query = (request.query_params.get("search") or "").strip().lower()
    brand_filter = (request.query_params.get("brand") or "").strip().lower()
    product_type_filter = (request.query_params.get("product_type") or "").strip().lower()
    location_filter = (request.query_params.get("location") or "").strip().lower()
    status_filter = (request.query_params.get("status") or "").strip().lower()

    def matches(item: Dict[str, Any]) -> bool:
        if query and query not in str(item.get("article_number") or "").lower() and query not in str(item.get("brand") or "").lower() and query not in str(item.get("product_type_name") or "").lower():
            return False
        if brand_filter and brand_filter not in str(item.get("brand") or "").lower():
            return False
        if product_type_filter and product_type_filter not in str(item.get("product_type_name") or "").lower():
            return False
        if location_filter and location_filter not in str(item.get("warehouse_location") or "").lower():
            return False
        if status_filter and status_filter != str(item.get("status") or "").lower():
            return False
        return True

    filtered_items = [item for item in items if matches(item)]
    filtered_items.sort(key=lambda item: item.get("article_number") or "")
    return {"items": filtered_items}


def _build_production_traceability_payload(
    *,
    view: str = "article",
    search: Optional[str] = None,
    article: Optional[str] = None,
    vendor: Optional[str] = None,
    supplier: Optional[str] = None,
    buyer: Optional[str] = None,
    brand: Optional[str] = None,
    product: Optional[str] = None,
    material: Optional[str] = None,
    order: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> Dict[str, Any]:
    search_value = ((search or article or "")).strip().lower()
    view_key = (view or "article").strip().lower() or "article"

    def _parse_date(value):
        if not value:
            return None
        if isinstance(value, datetime):
            return value
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except Exception:
            return None

    def _matches_date(value, start_dt, end_dt):
        if not value:
            return True
        dt = _parse_date(value)
        if dt is None:
            return True
        if start_dt is not None and dt < start_dt:
            return False
        if end_dt is not None and dt > end_dt:
            return False
        return True

    with SessionLocal() as session:
        order_rows = session.query(OrderORM).filter(
            OrderORM.company_id == _current_company_id(),
            OrderORM.archived.isnot(True),
        ).all()
        buyer_rows = session.query(BuyerORM).filter(
            BuyerORM.company_id == _current_company_id(),
            BuyerORM.archived.isnot(True),
        ).all()
        product_rows = session.query(ProductTypeORM).filter(
            ProductTypeORM.company_id == _current_company_id(),
            ProductTypeORM.archived.isnot(True),
        ).all()
        vendor_rows = session.query(VendorORM).filter(
            VendorORM.company_id == _current_company_id(),
            VendorORM.archived.isnot(True),
        ).all()
        fabric_dispatch_rows = session.query(FabricDispatchORM).filter(
            FabricDispatchORM.company_id == _current_company_id(),
            FabricDispatchORM.archived.isnot(True),
        ).all()
        return_rows = session.query(ProductionReturnORM).filter(
            ProductionReturnORM.company_id == _current_company_id(),
            ProductionReturnORM.archived.isnot(True),
        ).all()
        shipment_rows = session.query(ShipmentORM).filter(
            ShipmentORM.company_id == _current_company_id(),
            ShipmentORM.archived.isnot(True),
        ).all()
        shipment_product_rows = session.query(ShipmentProductORM).filter(
            ShipmentProductORM.company_id == _current_company_id(),
            ShipmentProductORM.archived.isnot(True),
        ).all()
        material_inventory_rows = session.query(MaterialInventoryORM).filter(
            MaterialInventoryORM.company_id == _current_company_id(),
            MaterialInventoryORM.archived.isnot(True),
        ).all()
        material_dispatch_rows = session.query(MaterialDispatchORM).filter(
            MaterialDispatchORM.company_id == _current_company_id(),
            MaterialDispatchORM.archived.isnot(True),
        ).all()
        material_adjustment_rows = session.query(MaterialAdjustmentORM).filter(
            MaterialAdjustmentORM.company_id == _current_company_id(),
            MaterialAdjustmentORM.archived.isnot(True),
        ).all()

    buyer_map = {row.id: row.name for row in buyer_rows if getattr(row, "id", "")}
    product_map = {row.id: row.name for row in product_rows if getattr(row, "id", "")}
    vendor_map = {row.id: row.name for row in vendor_rows if getattr(row, "id", "")}

    def _order_payload(order_row: OrderORM) -> Dict[str, Any]:
        return {
            "id": order_row.id,
            "order_number": order_row.order_number,
            "buyer_id": order_row.buyer_id,
            "buyer_name": buyer_map.get(order_row.buyer_id, ""),
            "product_type_id": order_row.product_type_id,
            "product_name": product_map.get(order_row.product_type_id, ""),
            "quantity": int(order_row.quantity or 0),
            "order_date": _dt_to_iso(order_row.order_date),
            "delivery_date": _dt_to_iso(order_row.delivery_date),
            "stage": order_row.stage,
        }

    def _get_job_work_rate(row: Any) -> float:
        for attr in ("job_work_rate_per_piece", "job_work_rate"):
            if hasattr(row, attr):
                value = getattr(row, attr, None)
                if value not in (None, ""):
                    return float(value)
        return 0.0

    order_payloads = [_order_payload(row) for row in order_rows]
    order_lookup = {row["id"]: row for row in order_payloads}

    dispatch_lookup: Dict[str, Dict[str, Any]] = {}
    for row in fabric_dispatch_rows:
        parsed_notes = _parse_dispatch_note_blob(row.notes or "")
        dispatch_payload = {
            "id": row.id,
            "dispatch_id": row.id,
            "dispatch_no": parsed_notes.get("dispatch_no") or row.id,
            "vendor_id": row.vendor_id,
            "vendor_name": vendor_map.get(row.vendor_id, ""),
            "order_id": row.order_id,
            "product_type_id": row.product_type_id,
            "product_name": product_map.get(row.product_type_id, ""),
            "kg_dispatched": float(row.kg_dispatched or 0),
            "date": _dt_to_iso(row.date),
            "expected_pieces": _coerce_number(parsed_notes.get("expected_pieces") or parsed_notes.get("quantity") or 0, 0.0),
            "quantity": _coerce_number(parsed_notes.get("quantity") or 0, 0.0),
            "unit": parsed_notes.get("unit") or "",
            "rolls": _coerce_number(parsed_notes.get("rolls") or 0, 0.0),
            "fabric_name": parsed_notes.get("fabric_name") or "",
            "brand_name": parsed_notes.get("brand_name") or "",
            "product_type_name": parsed_notes.get("product_type_name") or "",
            "notes": row.notes or "",
        }
        dispatch_lookup[row.id] = dispatch_payload

    return_payloads = []
    for row in return_rows:
        unpacked = _unpack_return_notes(row.notes or "")
        dispatch_id = row.order_id or ""
        dispatch_payload = dispatch_lookup.get(dispatch_id, {})
        return_expected_pieces = _coerce_number(unpacked.get("expected_pieces"), 0.0)
        effective_expected_pieces = return_expected_pieces if return_expected_pieces > 0 else _coerce_number(dispatch_payload.get("expected_pieces") or 0, 0.0)
        return_payload = {
            "id": row.id,
            "dispatch_id": dispatch_id,
            "dispatch_no": dispatch_payload.get("dispatch_no") or "",
            "vendor_id": row.vendor_id,
            "vendor_name": vendor_map.get(row.vendor_id, "") or dispatch_payload.get("vendor_name") or "",
            "product_type_id": row.product_type_id,
            "product_name": product_map.get(row.product_type_id, ""),
            "pieces_received": int(row.pieces_received or 0),
            "pieces_defected": int(row.pieces_defected or 0),
            "expected_pieces": round(effective_expected_pieces, 2),
            "pieces_left": round(max(effective_expected_pieces - float(row.pieces_received or 0), 0), 2),
            "job_work_rate": round(_get_job_work_rate(row), 2),
            "job_work_amount": round(float(row.pieces_received or 0) * _get_job_work_rate(row), 2),
            "challan_no": unpacked.get("challan_no") or "",
            "lot_no": unpacked.get("lot_no") or "",
            "article_number": unpacked.get("article_barcode") or "",
            "date": _dt_to_iso(row.date),
            "notes": unpacked.get("notes") or "",
            "brand_name": dispatch_payload.get("brand_name") or _note_value(row.notes or "", "Brand") or "",
            "warehouse_location": _note_value(row.notes or "", "Warehouse Location") or "",
        }
        return_payloads.append(return_payload)

    shipment_payloads = []
    shipments_by_id = {row.id: row for row in shipment_rows}
    for row in shipment_product_rows:
        shipment = shipments_by_id.get(row.shipment_id)
        if shipment is None:
            continue
        shipment_payloads.append({
            "id": row.id,
            "shipment_id": row.shipment_id,
            "shipment_no": shipment.shipment_no,
            "invoice_no": shipment.invoice_no,
            "customer": shipment.customer,
            "shipment_date": _dt_to_iso(shipment.shipment_date),
            "article_number": row.article_number or "",
            "brand": row.brand or "",
            "product_type_id": row.product_type_id,
            "product_name": row.product_type_name or product_map.get(row.product_type_id, ""),
            "pieces": int(row.dispatch_quantity or 0),
            "transport": shipment.transport,
        })

    material_inventory_payloads = []
    for row in material_inventory_rows:
        material_inventory_payloads.append({
            "id": row.id,
            "material_name": row.material_name,
            "supplier": row.supplier,
            "purchase_date": _dt_to_iso(row.date),
            "quantity_purchased": float(row.quantity or 0),
            "current_balance": float(row.quantity or 0),
            "unit": row.unit or "pcs",
            "rate": float(getattr(row, "rate", 0) or 0),
            "amount": float(getattr(row, "amount", 0) or 0),
        })

    material_dispatch_payloads = []
    for row in material_dispatch_rows:
        material_dispatch_payloads.append({
            "id": row.id,
            "dispatch_no": row.dispatch_no,
            "vendor_name": vendor_map.get(row.vendor_id, ""),
            "date": _dt_to_iso(row.date),
            "quantity": float(row.quantity or 0),
            "rate": float(getattr(row, "rate", 0) or 0),
            "amount": float(getattr(row, "amount", 0) or 0),
            "material_name": row.material_name,
            "supplier": row.purpose or "",
        })

    material_adjustment_payloads = []
    for row in material_adjustment_rows:
        material_adjustment_payloads.append({
            "id": row.id,
            "vendor_name": vendor_map.get(row.material_dispatch_id, "") or "",
            "payable_reference": row.payable_id or "",
            "amount": float(row.amount or 0),
        })

    start_dt = _parse_date(date_from)
    end_dt = _parse_date(date_to)
    if start_dt is not None and end_dt is not None and end_dt < start_dt:
        start_dt, end_dt = end_dt, start_dt

    def _filter_traceability_entities(items, *, date_field: str):
        return [item for item in items if _matches_date(item.get(date_field), start_dt, end_dt)]

    order_payloads = [item for item in order_payloads if _matches_date(item.get("order_date"), start_dt, end_dt)]
    dispatch_payloads = [item for item in dispatch_lookup.values() if _matches_date(item.get("date"), start_dt, end_dt)]
    return_payloads = [item for item in return_payloads if _matches_date(item.get("date"), start_dt, end_dt)]
    shipment_payloads = [item for item in shipment_payloads if _matches_date(item.get("shipment_date"), start_dt, end_dt)]
    material_inventory_payloads = [item for item in material_inventory_payloads if _matches_date(item.get("purchase_date"), start_dt, end_dt)]
    material_dispatch_payloads = [item for item in material_dispatch_payloads if _matches_date(item.get("date"), start_dt, end_dt)]
    material_adjustment_payloads = [item for item in material_adjustment_payloads if _matches_date(item.get("date"), start_dt, end_dt)]

    if vendor:
        vendor_value = vendor.lower()
        dispatch_payloads = [item for item in dispatch_payloads if vendor_value in (item.get("vendor_name") or "").lower()]
        return_payloads = [item for item in return_payloads if vendor_value in (item.get("vendor_name") or "").lower()]
        shipment_payloads = [item for item in shipment_payloads if vendor_value in (item.get("customer") or "").lower()]

    if supplier:
        supplier_value = supplier.lower()
        material_inventory_payloads = [item for item in material_inventory_payloads if supplier_value in (item.get("supplier") or "").lower()]
        material_dispatch_payloads = [item for item in material_dispatch_payloads if supplier_value in (item.get("supplier") or "").lower()]

    if buyer:
        buyer_value = buyer.lower()
        order_payloads = [item for item in order_payloads if buyer_value in (item.get("buyer_name") or "").lower()]
        shipment_payloads = [item for item in shipment_payloads if buyer_value in (item.get("customer") or "").lower()]

    if brand:
        brand_value = brand.lower()
        dispatch_payloads = [item for item in dispatch_payloads if brand_value in (item.get("brand_name") or "").lower()]
        return_payloads = [item for item in return_payloads if brand_value in (item.get("brand_name") or "").lower()]
        shipment_payloads = [item for item in shipment_payloads if brand_value in (item.get("brand") or "").lower()]

    if product:
        product_value = product.lower()
        order_payloads = [item for item in order_payloads if product_value in (item.get("product_name") or "").lower()]
        dispatch_payloads = [item for item in dispatch_payloads if product_value in (item.get("product_name") or "").lower() or product_value in (item.get("product_type_name") or "").lower()]
        return_payloads = [item for item in return_payloads if product_value in (item.get("product_name") or "").lower()]
        shipment_payloads = [item for item in shipment_payloads if product_value in (item.get("product_name") or "").lower()]

    if material:
        material_value = material.lower()
        material_inventory_payloads = [item for item in material_inventory_payloads if material_value in (item.get("material_name") or "").lower()]
        material_dispatch_payloads = [item for item in material_dispatch_payloads if material_value in (item.get("material_name") or "").lower()]

    if order:
        order_value = order.lower()
        order_payloads = [item for item in order_payloads if order_value in (item.get("order_number") or "").lower()]
        dispatch_payloads = [item for item in dispatch_payloads if order_value in (item.get("order_id") or "").lower() or order_value in (item.get("dispatch_no") or "").lower()]

    if view_key == "article":
        selected_returns = [item for item in return_payloads if search_value in (item.get("article_number") or "").lower() or search_value in (item.get("challan_no") or "").lower() or search_value in (item.get("dispatch_no") or "").lower() or search_value in (item.get("notes") or "").lower() or search_value in (item.get("vendor_name") or "").lower()]
        if not selected_returns and search_value:
            selected_returns = [item for item in return_payloads if search_value in (item.get("product_name") or "").lower() or search_value in (item.get("brand_name") or "").lower() or search_value in (item.get("vendor_name") or "").lower()]
        if not selected_returns:
            selected_returns = return_payloads[:1]
        article_number = selected_returns[0].get("article_number") or search_value or ""
        article_dispatch_ids = {item.get("dispatch_id") for item in selected_returns if item.get("dispatch_id")}
        article_dispatches = [item for item in dispatch_payloads if item.get("id") in article_dispatch_ids]
        article_returns = [item for item in selected_returns if (item.get("article_number") or "") == article_number or not article_number]
        article_shipments = [item for item in shipment_payloads if search_value in (item.get("article_number") or "").lower() or article_number in (item.get("article_number") or "").lower()]
        if not article_shipments and article_number:
            article_shipments = [item for item in shipment_payloads if item.get("article_number") == article_number]
        article_order = None
        if article_dispatches:
            order_id = article_dispatches[0].get("order_id")
            if order_id:
                article_order = next((item for item in order_payloads if item.get("id") == order_id), None)
        product_name = article_order.get("product_name") if article_order else (selected_returns[0].get("product_name") or "")
        buyer_name = article_order.get("buyer_name") if article_order else ""
        order_number = article_order.get("order_number") if article_order else ""
        order_quantity = article_order.get("quantity") if article_order else 0
        expected_pieces = sum(float(item.get("expected_pieces") or 0) for item in article_dispatches)
        pieces_received = sum(float(item.get("pieces_received") or 0) for item in article_returns)
        pieces_defected = sum(float(item.get("pieces_defected") or 0) for item in article_returns)
        pieces_shipped = sum(int(item.get("pieces") or 0) for item in article_shipments)
        current_balance = max(pieces_received - pieces_shipped, 0)
        warehouse_stock = max(pieces_received - pieces_shipped, 0)
        payload = {
            "view": "article",
            "article": {
                "article_number": article_number,
                "product_name": product_name,
                "brand": selected_returns[0].get("brand_name") or "",
                "buyer": buyer_name,
                "order_number": order_number,
                "order_quantity": order_quantity,
            },
            "summary": {
                "fabric_dispatched": round(sum(float(item.get("kg_dispatched") or 0) for item in article_dispatches), 2),
                "expected_pieces": round(expected_pieces, 2),
                "pieces_received": round(pieces_received, 2),
                "pieces_pending": round(max(expected_pieces - pieces_received, 0), 2),
                "warehouse_stock": round(warehouse_stock, 2),
                "pieces_shipped": round(pieces_shipped, 2),
                "current_balance": round(current_balance, 2),
                "defective_pieces": round(pieces_defected, 2),
            },
            "dispatches": article_dispatches,
            "returns": article_returns,
            "warehouse": [
                {
                    "warehouse": "Main Warehouse",
                    "date": item.get("date"),
                    "pieces_received": item.get("pieces_received"),
                    "pieces_shipped": 0,
                    "available_pieces": max(int(item.get("pieces_received") or 0) - pieces_shipped, 0),
                    "location": item.get("warehouse_location") or "Primary",
                }
                for item in article_returns
            ],
            "shipments": article_shipments,
            "timeline": [
                {"label": "Order Created", "date": article_order.get("order_date") if article_order else None, "type": "order"},
                {"label": "Fabric Dispatched", "date": article_dispatches[0].get("date") if article_dispatches else None, "type": "dispatch"},
                {"label": "Returns Received", "date": article_returns[0].get("date") if article_returns else None, "type": "return"},
                {"label": "Warehouse Entry", "date": article_returns[0].get("date") if article_returns else None, "type": "warehouse"},
                {"label": "Shipment", "date": article_shipments[0].get("shipment_date") if article_shipments else None, "type": "shipment"},
            ],
        }
        return payload

    if view_key == "product":
        selected_product = None
        for item in product_rows:
            if not search_value or search_value in (item.name or "").lower():
                selected_product = item
                break
        if selected_product is None and product_rows:
            selected_product = product_rows[0]
        if selected_product is None:
            return {"view": "product", "summary": {}, "articles": [], "vendors": [], "returns": [], "warehouse": [], "shipments": []}
        product_id = selected_product.id
        product_orders = [item for item in order_payloads if item.get("product_type_id") == product_id]
        product_dispatches = [item for item in dispatch_payloads if item.get("product_type_id") == product_id]
        product_returns = [item for item in return_payloads if item.get("product_type_id") == product_id]
        product_shipments = [item for item in shipment_payloads if item.get("product_type_id") == product_id]
        vendor_buckets: Dict[str, Dict[str, Any]] = {}
        for item in product_dispatches:
            bucket = vendor_buckets.setdefault(item.get("vendor_name") or "Unknown", {"vendor": item.get("vendor_name") or "Unknown", "articles_produced": 0, "dispatches": 0, "pieces_received": 0, "pending_pieces": 0})
            bucket["articles_produced"] += 1
            bucket["dispatches"] += 1
            bucket["pieces_received"] += sum(float(return_item.get("pieces_received") or 0) for return_item in product_returns if return_item.get("dispatch_id") == item.get("id"))
            bucket["pending_pieces"] += max(float(item.get("expected_pieces") or 0) - sum(float(return_item.get("pieces_received") or 0) for return_item in product_returns if return_item.get("dispatch_id") == item.get("id")), 0)
        return {
            "view": "product",
            "product": {"name": selected_product.name},
            "summary": {
                "total_articles": len(product_orders),
                "total_orders": len(product_orders),
                "total_fabric_used": round(sum(float(item.get("kg_dispatched") or 0) for item in product_dispatches), 2),
                "total_fabric_dispatched": round(sum(float(item.get("kg_dispatched") or 0) for item in product_dispatches), 2),
                "total_expected_pieces": round(sum(float(item.get("expected_pieces") or 0) for item in product_dispatches), 2),
                "total_pieces_received": round(sum(float(item.get("pieces_received") or 0) for item in product_returns), 2),
                "total_pending_pieces": round(sum(max(float(item.get("expected_pieces") or 0) - float(return_item.get("pieces_received") or 0), 0) for item in product_dispatches for return_item in product_returns if return_item.get("dispatch_id") == item.get("id")), 2),
                "warehouse_stock": round(sum(float(item.get("pieces_received") or 0) for item in product_returns) - sum(int(item.get("pieces") or 0) for item in product_shipments), 2),
                "total_shipment": round(sum(int(item.get("pieces") or 0) for item in product_shipments), 2),
            },
            "articles": product_orders,
            "vendors": list(vendor_buckets.values()),
            "returns": product_returns,
            "warehouse": product_returns,
            "shipments": product_shipments,
        }

    if view_key == "brand":
        selected_brand = brand or search_value or ""
        brand_dispatches = [item for item in dispatch_payloads if selected_brand in (item.get("brand_name") or "").lower()]
        brand_returns = [item for item in return_payloads if selected_brand in (item.get("brand_name") or "").lower()]
        brand_shipments = [item for item in shipment_payloads if selected_brand in (item.get("brand") or "").lower()]
        return {
            "view": "brand",
            "brand": selected_brand,
            "summary": {
                "total_products": len({item.get("product_type_id") for item in brand_dispatches if item.get("product_type_id")}),
                "total_articles": len({item.get("dispatch_id") for item in brand_dispatches if item.get("dispatch_id")}),
                "total_orders": len({item.get("order_id") for item in brand_dispatches if item.get("order_id")}),
                "total_vendors": len({item.get("vendor_name") for item in brand_dispatches if item.get("vendor_name")}),
                "total_dispatches": len(brand_dispatches),
                "total_pieces_received": round(sum(float(item.get("pieces_received") or 0) for item in brand_returns), 2),
                "total_pending": round(sum(max(float(item.get("expected_pieces") or 0) - float(return_item.get("pieces_received") or 0), 0) for item in brand_dispatches for return_item in brand_returns if return_item.get("dispatch_id") == item.get("id")), 2),
                "warehouse_stock": round(sum(float(item.get("pieces_received") or 0) for item in brand_returns) - sum(int(item.get("pieces") or 0) for item in brand_shipments), 2),
                "total_shipment": round(sum(int(item.get("pieces") or 0) for item in brand_shipments), 2),
            },
            "products": [item for item in dispatch_payloads if selected_brand in (item.get("brand_name") or "").lower()],
            "articles": [item for item in dispatch_payloads if selected_brand in (item.get("brand_name") or "").lower()],
            "vendors": [{"vendor": item.get("vendor_name") or "Unknown", "dispatches": 1, "received": 0, "pending": 0} for item in brand_dispatches],
            "returns": brand_returns,
            "warehouse": brand_returns,
            "shipments": brand_shipments,
        }

    if view_key == "material":
        selected_material = material or search_value or ""
        selected_material_inventory = [item for item in material_inventory_payloads if selected_material in (item.get("material_name") or "").lower()]
        selected_material_dispatches = [item for item in material_dispatch_payloads if selected_material in (item.get("material_name") or "").lower()]
        selected_adjustments = [item for item in material_adjustment_payloads if selected_material in (item.get("material_name") or "").lower()]
        return {
            "view": "material",
            "material": selected_material,
            "purchase": selected_material_inventory,
            "material_dispatch": selected_material_dispatches,
            "material_adjustment": selected_adjustments,
            "summary": {
                "purchased": round(sum(float(item.get("quantity_purchased") or 0) for item in selected_material_inventory), 2),
                "dispatched": round(sum(float(item.get("quantity") or 0) for item in selected_material_dispatches), 2),
                "available": round(sum(float(item.get("quantity_purchased") or 0) for item in selected_material_inventory) - sum(float(item.get("quantity") or 0) for item in selected_material_dispatches), 2),
            },
        }

    if view_key == "order":
        selected_order = None
        for item in order_payloads:
            if not search_value or search_value in (item.get("order_number") or "").lower():
                selected_order = item
                break
        if not selected_order and order_payloads:
            selected_order = order_payloads[0]
        if selected_order is None:
            return {"view": "order", "order": {}, "timeline": []}
        order_dispatches = [item for item in dispatch_payloads if item.get("order_id") == selected_order.get("id")]
        order_returns = [item for item in return_payloads if item.get("dispatch_id") in {dispatch.get("id") for dispatch in order_dispatches}]
        order_shipments = [item for item in shipment_payloads if selected_order.get("order_number") and selected_order.get("order_number") in (item.get("shipment_no") or "").lower()]
        return {
            "view": "order",
            "order": selected_order,
            "summary": {
                "buyer": selected_order.get("buyer_name"),
                "order_date": selected_order.get("order_date"),
                "delivery_date": selected_order.get("delivery_date"),
                "order_status": selected_order.get("stage"),
                "quantity_ordered": selected_order.get("quantity"),
                "quantity_produced": round(sum(float(item.get("expected_pieces") or 0) for item in order_dispatches), 2),
                "quantity_shipped": round(sum(int(item.get("pieces") or 0) for item in order_shipments), 2),
                "pending_quantity": round(max(int(selected_order.get("quantity") or 0) - sum(int(item.get("pieces") or 0) for item in order_shipments), 0), 2),
            },
            "dispatches": order_dispatches,
            "returns": order_returns,
            "warehouse": order_returns,
            "shipments": order_shipments,
            "timeline": [
                {"label": "Order", "date": selected_order.get("order_date"), "type": "order"},
                {"label": "Fabric Purchase", "date": order_dispatches[0].get("date") if order_dispatches else None, "type": "dispatch"},
                {"label": "Fabric Dispatch", "date": order_dispatches[0].get("date") if order_dispatches else None, "type": "dispatch"},
                {"label": "Returns & QC", "date": order_returns[0].get("date") if order_returns else None, "type": "return"},
                {"label": "Warehouse", "date": order_returns[0].get("date") if order_returns else None, "type": "warehouse"},
                {"label": "Shipment", "date": order_shipments[0].get("shipment_date") if order_shipments else None, "type": "shipment"},
            ],
        }

    return {"view": view_key, "summary": {}, "articles": [], "vendors": [], "returns": [], "warehouse": [], "shipments": []}


@api_router.get("/production-traceability")
async def production_traceability(
    view: Optional[str] = None,
    view_by: Optional[str] = None,
    search: Optional[str] = None,
    article: Optional[str] = None,
    vendor: Optional[str] = None,
    supplier: Optional[str] = None,
    buyer: Optional[str] = None,
    brand: Optional[str] = None,
    product: Optional[str] = None,
    material: Optional[str] = None,
    order: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    effective_view = (view_by or view or "article").strip() or "article"
    return _build_production_traceability_payload(
        view=effective_view,
        search=search,
        article=article,
        vendor=vendor,
        supplier=supplier,
        buyer=buyer,
        brand=brand,
        product=product,
        material=material,
        order=order,
        date_from=date_from,
        date_to=date_to,
    )


@api_router.get("/production-traceability/export")
async def export_production_traceability(
    view: Optional[str] = None,
    view_by: Optional[str] = None,
    search: Optional[str] = None,
    article: Optional[str] = None,
    vendor: Optional[str] = None,
    supplier: Optional[str] = None,
    buyer: Optional[str] = None,
    brand: Optional[str] = None,
    product: Optional[str] = None,
    material: Optional[str] = None,
    order: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    payload = _build_production_traceability_payload(
        view=(view_by or view or "article").strip() or "article",
        search=search,
        article=article,
        vendor=vendor,
        supplier=supplier,
        buyer=buyer,
        brand=brand,
        product=product,
        material=material,
        order=order,
        date_from=date_from,
        date_to=date_to,
    )
    try:
        import pandas as pd
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Excel export dependency error: {exc}")

    rows = []
    if payload.get("view") == "article":
        rows.extend(payload.get("dispatches") or [])
        rows.extend(payload.get("returns") or [])
        rows.extend(payload.get("shipments") or [])
    elif payload.get("view") == "material":
        rows.extend(payload.get("purchase") or [])
        rows.extend(payload.get("material_dispatch") or [])
        rows.extend(payload.get("material_adjustment") or [])
    else:
        rows.extend(payload.get("dispatches") or [])
        rows.extend(payload.get("returns") or [])
        rows.extend(payload.get("shipments") or [])

    df = pd.DataFrame(rows)
    buffer = io.BytesIO()
    try:
        with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
            df.to_excel(writer, index=False, sheet_name="Traceability")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to generate Excel file: {exc}")

    buffer.seek(0)
    headers = {"Content-Disposition": "attachment; filename=production_traceability.xlsx"}
    return StreamingResponse(buffer, headers=headers, media_type="application/vnd.openxmlformats-officedocument/spreadsheetml.sheet")


@api_router.get("/export/shipments")
async def export_shipments(search: Optional[str] = None):
    with SessionLocal() as session:
        query = session.query(ShipmentORM).filter(ShipmentORM.company_id == _current_company_id())
        if search:
            like = f"%{search.lower()}%"
            query = query.filter(func.lower(ShipmentORM.shipment_no).like(like) | func.lower(ShipmentORM.customer).like(like))
        rows = query.order_by(ShipmentORM.created_at.desc()).all()

    import pandas as pd

    export_rows = []
    for shipment in rows:
        products = []
        with SessionLocal() as session:
            product_rows = session.query(ShipmentProductORM).filter(
                ShipmentProductORM.shipment_id == shipment.id,
                ShipmentProductORM.company_id == _current_company_id(),
            ).all()
            products = [
                f"{row.article_number or ''}:{row.dispatch_quantity or 0}" for row in product_rows
            ]
        export_rows.append({
            "Shipment No": shipment.shipment_no,
            "Customer": shipment.customer,
            "Date": _dt_to_iso(shipment.shipment_date),
            "Invoice No": shipment.invoice_no,
            "Vehicle No": shipment.vehicle_no,
            "Destination": shipment.destination,
            "Products": " | ".join(products),
            "Status": shipment.status,
        })

    df = pd.DataFrame(export_rows)
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Shipments")
    buffer.seek(0)
    headers = {"Content-Disposition": "attachment; filename=shipments.xlsx"}
    return StreamingResponse(buffer, headers=headers, media_type="application/vnd.openxmlformats-officedocument/spreadsheetml.sheet")


# ============ PRODUCTION RETURNS ============
def _build_fabric_dispatch_index(include_archived: bool = False) -> Dict[str, Dict[str, Any]]:
    with SessionLocal() as session:
        query = session.query(FabricDispatchORM)
        if not include_archived:
            query = query.filter(FabricDispatchORM.archived.isnot(True))
        dispatch_rows = query.all()

        vendor_ids = list({row.vendor_id for row in dispatch_rows if row.vendor_id})
        vendors = session.query(VendorORM).filter(VendorORM.id.in_(vendor_ids)).all() if vendor_ids else []
        vendor_map = {vendor.id: vendor.name for vendor in vendors}

    index: Dict[str, Dict[str, Any]] = {}
    for row in dispatch_rows:
        parsed_notes = _parse_dispatch_note_blob(row.notes or "")
        dispatch_no = parsed_notes.get("dispatch_no") or row.id
        explicit_expected_pieces = _coerce_number(getattr(row, "expected_pieces", None), 0.0)
        expected_pieces = explicit_expected_pieces if explicit_expected_pieces > 0 else _coerce_number(parsed_notes.get("expected_pieces") or parsed_notes.get("quantity") or 0, 0.0)
        avg_fabric_per_piece = _coerce_number(parsed_notes.get("avg_fabric_per_piece"), 0.0)
        index[row.id] = {
            "id": row.id,
            "dispatch_id": row.id,
            "dispatch_no": dispatch_no,
            "vendor_id": row.vendor_id,
            "vendor_name": vendor_map.get(row.vendor_id, "Unknown"),
            "product_type_id": row.product_type_id,
            "kg_dispatched": float(row.kg_dispatched or 0),
            "expected_pieces": expected_pieces,
            "avg_fabric_per_piece": avg_fabric_per_piece,
            "fabric_name": parsed_notes.get("fabric_name") or "",
            "brand_name": parsed_notes.get("brand_name") or "",
            "product_type_name": parsed_notes.get("product_type_name") or "",
            "quantity": _coerce_number(parsed_notes.get("quantity"), 0.0),
            "unit": parsed_notes.get("unit") or "",
            "rolls": _coerce_number(parsed_notes.get("rolls"), 0.0),
            "date": _dt_to_iso(row.date),
            "challan_no": parsed_notes.get("challan_no") or "",
        }
    return index


def _enrich_return_row(
    row: Dict[str, Any],
    dispatch_index: Dict[str, Dict[str, Any]],
    pieces_left_by_row_id: Dict[str, float],
) -> Dict[str, Any]:
    dispatch_id = row.get("dispatch_id") or row.get("order_id")
    dispatch = dispatch_index.get(dispatch_id or "")
    pieces_received = float(row.get("pieces_received") or 0)
    unpacked_notes = _unpack_return_notes(row.get("notes") or "")
    expected_pieces = _coerce_number(unpacked_notes.get("expected_pieces"), 0.0)
    if expected_pieces <= 0:
        expected_pieces = _coerce_number((dispatch or {}).get("expected_pieces"), 0.0)
    avg_fabric_per_piece = _coerce_number(unpacked_notes.get("avg_fabric_per_piece"), 0.0)
    row_id = str(row.get("id") or "")
    computed_left = pieces_left_by_row_id.get(row_id)
    pieces_left = max(float(computed_left) if computed_left is not None else expected_pieces, 0)
    job_work_rate = _coerce_number(row.get("job_work_rate") if row.get("job_work_rate") is not None else row.get("job_work_rate_per_piece"), 0.0)
    job_work_amount = round(pieces_received * job_work_rate, 2)
    row["dispatch_id"] = dispatch_id
    row["dispatch_no"] = (dispatch or {}).get("dispatch_no") or row.get("dispatch_no") or ""
    row["vendor_id"] = (dispatch or {}).get("vendor_id") or row.get("vendor_id")
    row["vendor_name"] = (dispatch or {}).get("vendor_name") or row.get("vendor_name") or "Unknown"
    row["pieces_left"] = round(pieces_left, 3)
    row["fabric_consumed_kg"] = round(_coerce_number(row.get("fabric_consumed_kg"), 0.0), 3)
    row["dispatched_pieces"] = round(expected_pieces, 3)
    row["expected_pieces"] = round(expected_pieces, 3)
    row["avg_fabric_per_piece"] = round(avg_fabric_per_piece, 3)
    row["fabric_still_lying_kg"] = round(_coerce_number(unpacked_notes.get("fabric_still_lying_kg"), 0.0), 3)
    row["job_work_rate_per_piece"] = round(job_work_rate, 2)
    row["job_work_rate"] = round(job_work_rate, 2)
    row["job_work_amount"] = job_work_amount
    row["pieces_received"] = int(pieces_received) if pieces_received.is_integer() else round(pieces_received, 3)
    return row


def _resolve_job_work_rate(raw_data: Dict[str, Any], existing: Optional[Dict[str, Any]] = None) -> float:
    if raw_data is None:
        raw_data = {}
    rate = raw_data.get("job_work_rate")
    if rate is None:
        rate = raw_data.get("job_work_rate_per_piece")
    if rate is None and existing is not None:
        rate = existing.get("job_work_rate")
        if rate is None:
            rate = existing.get("job_work_rate_per_piece")
    return round(_coerce_number(rate, 0.0), 2)


def _upsert_production_return_payable(session, return_row, vendor_name: str, reference_no: str, job_work_amount: float) -> None:
    note_token = f"production_return_id:{return_row.id}"
    existing = session.query(PayableORM).filter(PayableORM.notes.like(f"%{note_token}%"), PayableORM.archived.isnot(True)).order_by(PayableORM.created_at.desc()).first()
    if existing is None and reference_no:
        existing = session.query(PayableORM).filter(PayableORM.reference_no == reference_no, PayableORM.archived.isnot(True)).order_by(PayableORM.created_at.desc()).first()
    if existing is not None and getattr(existing, "company_id", None) != _current_company_id():
        existing.company_id = _current_company_id()
    existing_notes = existing.notes or "" if existing else ""
    note_text = existing_notes or ""
    if note_token not in note_text:
        note_text = f"{note_text} | {note_token}".strip(" |") if note_text else note_token

    if existing is None:
        existing = PayableORM(
            company_id=_ensure_default_company_id(),
            vendor=vendor_name or "Unknown Vendor",
            reference_no=reference_no or f"PR-{return_row.id}",
            source="Job Work",
            total_amount=0.0,
            original_job_work_amount=0.0,
            paid_amount=0.0,
            total_material_adjustment=0.0,
            net_payable_amount=0.0,
            outstanding_balance=0.0,
            balance_amount=0.0,
            status="Pending",
            notes=note_text,
        )
        session.add(existing)
        session.flush()

    existing.vendor = vendor_name or "Unknown Vendor"
    existing.reference_no = reference_no or f"PR-{return_row.id}"
    existing.source = "Job Work"
    existing.original_job_work_amount = round(float(job_work_amount or 0.0), 2)
    if note_token not in (existing.notes or ""):
        existing.notes = note_text
    else:
        existing.notes = note_text
    _recalculate_payable_amounts(session, existing)
    party = _resolve_party_from_name(session, existing.vendor or "", "Vendor")
    if party is not None:
        _upsert_party_ledger_entry(
            session,
            party,
            return_row.date or now_utc(),
            "Job Work Bills",
            existing.reference_no or f"PR-{return_row.id}",
            "Job work bill",
            round(float(existing.original_job_work_amount or 0.0), 2),
            0.0,
            "Job work bill",
            "payable",
            existing.id,
            "Debit",
        )

    existing_tx = session.query(PaymentTransactionORM).filter(
        PaymentTransactionORM.payable_id == existing.id,
        PaymentTransactionORM.transaction_type == "Adjustment",
        PaymentTransactionORM.notes.like(f"%{note_token}%"),
        PaymentTransactionORM.archived.isnot(True),
    ).first()
    if existing_tx is None:
        session.add(PaymentTransactionORM(
            company_id=_ensure_default_company_id(),
            date=return_row.date,
            transaction_type="Adjustment",
            party=existing.vendor or "Unknown Vendor",
            reference_no=existing.reference_no or f"PR-{return_row.id}",
            payable_id=existing.id,
            receivable_id=None,
            amount=round(float(job_work_amount or 0.0), 2),
            payment_mode="Cash",
            notes=note_text,
        ))
    else:
        existing_tx.amount = round(float(job_work_amount or 0.0), 2)
        existing_tx.reference_no = existing.reference_no or f"PR-{return_row.id}"
        existing_tx.notes = note_text


def _resolve_capacity_expected_pieces(dispatch: Optional[Dict[str, Any]], expected_pieces_override: Optional[float] = None) -> float:
    explicit = _coerce_number(expected_pieces_override, 0.0)
    if explicit > 0:
        return explicit
    dispatch_expected = _coerce_number((dispatch or {}).get("expected_pieces"), 0.0)
    if dispatch_expected > 0:
        return dispatch_expected
    dispatch_quantity = _coerce_number((dispatch or {}).get("kg_dispatched"), 0.0)
    return dispatch_quantity if dispatch_quantity > 0 else 0.0


def _resolve_dispatch_expected_pieces(dispatch: Optional[Dict[str, Any]], receipt_rows: Optional[List[Dict[str, Any]]] = None) -> float:
    dispatch_expected = _coerce_number((dispatch or {}).get("expected_pieces"), 0.0)
    if dispatch_expected > 0:
        return dispatch_expected
    if not receipt_rows:
        return 0.0
    receipt_expected_values = []
    for row in receipt_rows:
        unpacked_notes = _unpack_return_notes(row.get("notes") or "")
        receipt_expected = _coerce_number(unpacked_notes.get("expected_pieces"), 0.0)
        if receipt_expected > 0:
            receipt_expected_values.append(receipt_expected)
    if receipt_expected_values:
        return max(receipt_expected_values)
    return 0.0


async def _assert_dispatch_receipt_capacity(
    dispatch_id: str,
    pieces_received: float,
    *,
    ignore_return_id: Optional[str] = None,
    expected_pieces_override: Optional[float] = None,
) -> Dict[str, Any]:
    dispatch_index = _build_fabric_dispatch_index(include_archived=False)
    dispatch = dispatch_index.get(dispatch_id)
    if dispatch is None:
        raise HTTPException(status_code=400, detail="Selected dispatch not found")

    with SessionLocal() as session:
        query = session.query(ProductionReturnORM).filter(
            ProductionReturnORM.order_id == dispatch_id,
            ProductionReturnORM.archived.isnot(True),
        )
        if ignore_return_id:
            query = query.filter(ProductionReturnORM.id != ignore_return_id)
        existing_rows = query.all()
    already_received = sum(float(row.pieces_received or 0) for row in existing_rows)

    expected_pieces = _resolve_capacity_expected_pieces(dispatch, expected_pieces_override)

    if expected_pieces > 0 and already_received + pieces_received > expected_pieces + 1e-9:
        available = max(expected_pieces - already_received, 0)
        raise HTTPException(
            status_code=400,
            detail=(
                f"Pieces Received exceeds dispatch balance. "
                f"Expected Pieces: {expected_pieces:.3f}, already received: {already_received:.3f}, "
                f"available: {available:.3f}"
            ),
        )

    return {
        "dispatch": dispatch,
        "already_received": already_received,
        "pieces_left": max(expected_pieces - already_received - pieces_received, 0),
    }


@api_router.get("/production-returns", response_model=List[ProductionReturn])
async def list_production_returns(include_archived: bool = False):
    rows = await _list(store.production_returns, include_archived)
    dispatch_index = _build_fabric_dispatch_index(include_archived=True)

    sorted_rows = sorted(
        [row for row in rows if not row.get("archived")],
        key=lambda row: (
            str(row.get("dispatch_id") or row.get("order_id") or ""),
            str(row.get("date") or ""),
            str(row.get("created_at") or ""),
            str(row.get("id") or ""),
        ),
    )
    pieces_left_by_row_id: Dict[str, float] = {}
    for row in sorted_rows:
        dispatch_id = str(row.get("dispatch_id") or row.get("order_id") or "")
        if not dispatch_id:
            continue
        unpacked_notes = _unpack_return_notes(row.get("notes") or "")
        dispatch = dispatch_index.get(dispatch_id)
        expected_pieces = _coerce_number(unpacked_notes.get("expected_pieces"), 0.0)
        if expected_pieces <= 0:
            expected_pieces = _resolve_capacity_expected_pieces(dispatch, 0.0)
        pieces_received = float(row.get("pieces_received") or 0)
        row_left = max(expected_pieces - pieces_received, 0) if expected_pieces > 0 else 0.0
        pieces_left_by_row_id[str(row.get("id") or "")] = row_left

    return [_enrich_return_row(dict(row), dispatch_index, pieces_left_by_row_id) for row in rows]


@api_router.get("/production-returns/dispatches")
async def list_return_dispatch_options():
    dispatch_index = _build_fabric_dispatch_index(include_archived=False)
    rows = await _list(store.production_returns, include_archived=False)
    received_by_dispatch: Dict[str, float] = {}
    receipt_rows_by_dispatch: Dict[str, List[Dict[str, Any]]] = {}
    for row in rows:
        dispatch_id = row.get("dispatch_id") or row.get("order_id")
        if not dispatch_id:
            continue
        received_by_dispatch[dispatch_id] = received_by_dispatch.get(dispatch_id, 0) + float(row.get("pieces_received") or 0)
        receipt_rows_by_dispatch.setdefault(dispatch_id, []).append(row)

    options = []
    for dispatch in dispatch_index.values():
        dispatch_id = dispatch["id"]
        expected_pieces = _resolve_dispatch_expected_pieces(dispatch, receipt_rows_by_dispatch.get(dispatch_id, []))
        received_qty = float(received_by_dispatch.get(dispatch_id, 0))
        pieces_left = round(max(expected_pieces - received_qty, 0), 3) if expected_pieces > 0 else 0.0
        if pieces_left <= 1e-9:
            continue
        options.append({
            **dispatch,
            "pieces_received_total": round(received_qty, 3),
            "pieces_left": pieces_left,
        })
    options.sort(key=lambda item: item.get("date") or "", reverse=True)
    return options


@api_router.get("/production-returns/dispatches/{dispatch_id}")
async def get_return_dispatch_details(dispatch_id: str):
    dispatch_index = _build_fabric_dispatch_index(include_archived=False)
    dispatch = dispatch_index.get(dispatch_id)
    if dispatch is None:
        raise HTTPException(status_code=404, detail="Dispatch not found")

    rows = await _list(store.production_returns, include_archived=False)
    receipt_rows = [row for row in rows if (row.get("dispatch_id") or row.get("order_id")) == dispatch_id]
    received_total = sum(float(row.get("pieces_received") or 0) for row in receipt_rows)
    expected_pieces = _resolve_dispatch_expected_pieces(dispatch, receipt_rows)
    return {
        **dispatch,
        "pieces_received_total": round(received_total, 3),
        "pieces_left": round(max(expected_pieces - received_total, 0), 3) if expected_pieces > 0 else None,
    }


@api_router.post("/production-returns", response_model=ProductionReturn)
async def create_production_return(payload: ProductionReturnCreate):
    data = payload.model_dump()
    dispatch_id = (data.get("dispatch_id") or "").strip()
    if not dispatch_id:
        raise HTTPException(status_code=400, detail="Dispatch is required")

    pieces_received = float(data.get("pieces_received") or 0)

    dispatch = _build_fabric_dispatch_index(include_archived=False).get(dispatch_id)
    if dispatch is None:
        raise HTTPException(status_code=400, detail="Selected dispatch not found")

    expected_pieces = _coerce_number(data.get("expected_pieces"), 0.0)
    avg_fabric_per_piece = _coerce_number(data.get("avg_fabric_per_piece"), 0.0)
    if expected_pieces <= 0 and _coerce_number(dispatch.get("expected_pieces"), 0.0) > 0:
        expected_pieces = round(_coerce_number(dispatch.get("expected_pieces"), 0.0), 3)
    if expected_pieces <= 0 and avg_fabric_per_piece > 0 and dispatch.get("kg_dispatched"):
        expected_pieces = round(_coerce_number(dispatch.get("kg_dispatched"), 0.0) / avg_fabric_per_piece, 3)

    capacity = await _assert_dispatch_receipt_capacity(
        dispatch_id,
        pieces_received,
        expected_pieces_override=expected_pieces,
    )

    data["vendor_id"] = dispatch["vendor_id"]
    data["order_id"] = dispatch_id
    data["product_type_id"] = data.get("product_type_id") or dispatch.get("product_type_id") or "dispatch-linked"
    if not data.get("date"):
        data["date"] = now_iso()

    job_work_rate = _resolve_job_work_rate(data)
    job_work_amount = round(pieces_received * job_work_rate, 2)

    fabric_still_lying_kg = data.get("fabric_still_lying_kg")
    if fabric_still_lying_kg is None:
        fabric_still_lying_kg = None
    else:
        fabric_still_lying_kg = _coerce_number(fabric_still_lying_kg, 0.0)

    packed_notes = _pack_return_notes(
        notes=str(data.get("notes") or "").strip(),
        challan_no=str(data.get("challan_no") or "").strip(),
        lot_no=str(data.get("lot_no") or "").strip(),
        article_barcode=str(data.get("article_barcode") or "").strip(),
        expected_pieces=expected_pieces,
        avg_fabric_per_piece=avg_fabric_per_piece,
        fabric_still_lying_kg=fabric_still_lying_kg,
    )

    if fabric_still_lying_kg is not None:
        data["fabric_consumed_kg"] = round(max(_coerce_number(dispatch.get("kg_dispatched"), 0.0) - float(fabric_still_lying_kg), 0.0), 3)

    payload_fields = {k: v for k, v in data.items() if k not in {"dispatch_id", "challan_no", "lot_no", "article_barcode", "notes", "job_work_rate", "job_work_rate_per_piece", "expected_pieces", "avg_fabric_per_piece", "fabric_still_lying_kg"}}
    obj = ProductionReturn(
        **payload_fields,
        dispatch_id=dispatch_id,
        dispatch_no=dispatch.get("dispatch_no") or "",
        vendor_name=dispatch.get("vendor_name") or "",
        pieces_left=round(capacity["pieces_left"], 3),
        challan_no=str(data.get("challan_no") or ""),
        lot_no=str(data.get("lot_no") or ""),
        article_barcode=str(data.get("article_barcode") or ""),
        expected_pieces=expected_pieces,
        avg_fabric_per_piece=avg_fabric_per_piece,
        fabric_still_lying_kg=fabric_still_lying_kg,
        job_work_rate_per_piece=job_work_rate,
        job_work_rate=job_work_rate,
        job_work_amount=job_work_amount,
        notes=str(data.get("notes") or "").strip(),
    )
    store_doc = {
        "id": obj.id,
        "company_id": _ensure_default_company_id(),
        "vendor_id": data.get("vendor_id") or dispatch.get("vendor_id") or "",
        "order_id": dispatch_id,
        "product_type_id": data.get("product_type_id") or dispatch.get("product_type_id") or "dispatch-linked",
        "pieces_received": int(float(data.get("pieces_received") or 0)),
        "fabric_consumed_kg": float(data.get("fabric_consumed_kg") or 0.0),
        "pieces_defected": int(float(data.get("pieces_defected") or 0)),
        "kg_used": float(data.get("kg_used") or 0),
        "fabric_returned_kg": float(data.get("fabric_returned_kg") or 0),
        "cutting_waste_kg": float(data.get("cutting_waste_kg") or 0),
        "job_work_rate_per_piece": job_work_rate,
        "date": data.get("date") or now_iso(),
        "notes": packed_notes,
        "archived": False,
        "created_at": obj.created_at,
    }
    await _create(store.production_returns, store_doc)

    with SessionLocal() as session:
        row = session.query(ProductionReturnORM).filter(ProductionReturnORM.id == obj.id).first()
        if row is None:
            row = ProductionReturnORM(
                id=obj.id,
                company_id=_ensure_default_company_id(),
                vendor_id=data.get("vendor_id") or dispatch.get("vendor_id") or "",
                order_id=dispatch_id,
                product_type_id=data.get("product_type_id") or dispatch.get("product_type_id") or "dispatch-linked",
                pieces_received=int(float(data.get("pieces_received") or 0)),
                fabric_consumed_kg=float(data.get("fabric_consumed_kg") or 0.0),
                pieces_defected=int(float(data.get("pieces_defected") or 0)),
                kg_used=float(data.get("kg_used") or 0),
                fabric_returned_kg=float(data.get("fabric_returned_kg") or 0),
                cutting_waste_kg=float(data.get("cutting_waste_kg") or 0),
                job_work_rate_per_piece=job_work_rate,
                challan_no=str(data.get("challan_no") or "").strip(),
                lot_no=str(data.get("lot_no") or "").strip(),
                article_barcode=str(data.get("article_barcode") or "").strip(),
                expected_pieces=expected_pieces,
                avg_fabric_per_piece=avg_fabric_per_piece,
                fabric_still_lying_kg=float(fabric_still_lying_kg or 0.0),
                date=datetime.fromisoformat(data.get("date") or now_iso()) if isinstance(data.get("date"), str) else now_utc(),
                notes=packed_notes,
                archived=False,
            )
            session.add(row)
        else:
            row.vendor_id = data.get("vendor_id") or dispatch.get("vendor_id") or ""
            row.order_id = dispatch_id
            row.product_type_id = data.get("product_type_id") or dispatch.get("product_type_id") or "dispatch-linked"
            row.pieces_received = int(float(data.get("pieces_received") or 0))
            row.fabric_consumed_kg = float(data.get("fabric_consumed_kg") or 0.0)
            row.pieces_defected = int(float(data.get("pieces_defected") or 0))
            row.kg_used = float(data.get("kg_used") or 0)
            row.fabric_returned_kg = float(data.get("fabric_returned_kg") or 0)
            row.cutting_waste_kg = float(data.get("cutting_waste_kg") or 0)
            row.job_work_rate_per_piece = job_work_rate
            row.challan_no = str(data.get("challan_no") or "").strip()
            row.lot_no = str(data.get("lot_no") or "").strip()
            row.article_barcode = str(data.get("article_barcode") or "").strip()
            row.expected_pieces = expected_pieces
            row.avg_fabric_per_piece = avg_fabric_per_piece
            row.fabric_still_lying_kg = float(fabric_still_lying_kg or 0.0)
            row.date = datetime.fromisoformat(data.get("date") or now_iso()) if isinstance(data.get("date"), str) else now_utc()
            row.notes = packed_notes
            row.archived = False
        session.commit()

    with SessionLocal() as session:
        party = _resolve_party_from_name(session, dispatch.get("vendor_name") or dispatch.get("vendor"), "Vendor")
        if party is not None:
            _upsert_party_ledger_entry(
                session,
                party,
                datetime.fromisoformat(data.get("date") or now_iso()) if isinstance(data.get("date"), str) else now_utc(),
                "Returns & QC",
                str(data.get("challan_no") or "" or f"PR-{obj.id}"),
                "Job work return",
                round(job_work_amount, 2),
                0.0,
                "Returns and QC",
                "production_return",
                obj.id,
                "Debit",
            )
            session.commit()

    with SessionLocal() as session:
        dispatch_row = session.query(FabricDispatchORM).filter(FabricDispatchORM.id == dispatch_id).first()
        if dispatch_row is not None:
            dispatch_row.notes = _update_dispatch_note_payload(
                dispatch_row.notes or "",
                dispatchNo=dispatch.get("dispatch_no") or "",
            )
            session.commit()

    with SessionLocal() as session:
        return_row = session.query(ProductionReturnORM).filter(ProductionReturnORM.id == obj.id).first()
        if return_row is not None:
            vendor_name = session.query(VendorORM).filter(VendorORM.id == return_row.vendor_id).first()
            reference_no = str(data.get("challan_no") or "").strip() or f"PR-{return_row.id}"
            _upsert_production_return_payable(
                session,
                return_row,
                (vendor_name.name if vendor_name is not None else "Unknown Vendor"),
                reference_no,
                job_work_amount,
            )
            challan_link_id = (str(data.get("challan_no") or "").strip() or return_row.id).lower()
            existing_link = session.query(DispatchChallanLinkORM).filter(
                DispatchChallanLinkORM.dispatch_id == dispatch_id,
                DispatchChallanLinkORM.challan_id == challan_link_id,
                DispatchChallanLinkORM.archived.isnot(True),
            ).first()
            if existing_link is None:
                session.add(DispatchChallanLinkORM(
                    company_id=_ensure_default_company_id(),
                    dispatch_id=dispatch_id,
                    challan_id=challan_link_id,
                    allocated_quantity=float(data.get("fabric_consumed_kg") or 0.0),
                    allocated_pieces=int(float(data.get("pieces_received") or 0)),
                    archived=False,
                ))
            session.commit()

    return obj


@api_router.patch("/production-returns/{item_id}", response_model=ProductionReturn)
async def update_production_return(item_id: str, updates: Dict[str, Any]):
    existing = await _get(store.production_returns, item_id)

    next_dispatch_id = str(updates.get("dispatch_id") or updates.get("order_id") or existing.get("dispatch_id") or existing.get("order_id") or "").strip()
    if not next_dispatch_id:
        raise HTTPException(status_code=400, detail="Dispatch is required")

    next_pieces_received = float(updates.get("pieces_received") if "pieces_received" in updates else existing.get("pieces_received") or 0)

    unpacked_existing = _unpack_return_notes(existing.get("notes") or "")
    dispatch = _build_fabric_dispatch_index(include_archived=False).get(next_dispatch_id)
    if dispatch is None:
        raise HTTPException(status_code=400, detail="Selected dispatch not found")

    expected_pieces = _coerce_number(updates.get("expected_pieces") if "expected_pieces" in updates else unpacked_existing.get("expected_pieces"), 0.0)
    avg_fabric_per_piece = _coerce_number(updates.get("avg_fabric_per_piece") if "avg_fabric_per_piece" in updates else unpacked_existing.get("avg_fabric_per_piece"), 0.0)
    if expected_pieces <= 0 and _coerce_number(dispatch.get("expected_pieces"), 0.0) > 0:
        expected_pieces = round(_coerce_number(dispatch.get("expected_pieces"), 0.0), 3)
    if expected_pieces <= 0 and avg_fabric_per_piece > 0 and dispatch.get("kg_dispatched"):
        expected_pieces = round(_coerce_number(dispatch.get("kg_dispatched"), 0.0) / avg_fabric_per_piece, 3)

    capacity = await _assert_dispatch_receipt_capacity(
        next_dispatch_id,
        next_pieces_received,
        ignore_return_id=item_id,
        expected_pieces_override=expected_pieces,
    )

    fabric_still_lying_kg = updates.get("fabric_still_lying_kg") if "fabric_still_lying_kg" in updates else unpacked_existing.get("fabric_still_lying_kg")
    if fabric_still_lying_kg is None:
        fabric_still_lying_kg = None
    else:
        fabric_still_lying_kg = _coerce_number(fabric_still_lying_kg, 0.0)

    next_fabric_consumed = updates.get("fabric_consumed_kg", existing.get("fabric_consumed_kg", 0))
    if fabric_still_lying_kg is not None:
        next_fabric_consumed = round(max(_coerce_number(dispatch.get("kg_dispatched"), 0.0) - float(fabric_still_lying_kg), 0.0), 3)

    packed_notes = _pack_return_notes(
        notes=str(updates.get("notes") if "notes" in updates else existing.get("notes") or "").strip(),
        challan_no=str(updates.get("challan_no") if "challan_no" in updates else existing.get("challan_no") or "").strip(),
        lot_no=str(updates.get("lot_no") if "lot_no" in updates else existing.get("lot_no") or "").strip(),
        article_barcode=str(updates.get("article_barcode") if "article_barcode" in updates else existing.get("article_barcode") or "").strip(),
        expected_pieces=expected_pieces,
        avg_fabric_per_piece=avg_fabric_per_piece,
        fabric_still_lying_kg=fabric_still_lying_kg,
    )

    job_work_rate = _resolve_job_work_rate(updates, existing)
    job_work_amount = round(next_pieces_received * job_work_rate, 2)

    safe_updates = {
        "vendor_id": dispatch["vendor_id"],
        "order_id": next_dispatch_id,
        "product_type_id": updates.get("product_type_id") or existing.get("product_type_id") or dispatch.get("product_type_id") or "dispatch-linked",
        "pieces_received": int(next_pieces_received) if float(next_pieces_received).is_integer() else next_pieces_received,
        "fabric_consumed_kg": next_fabric_consumed,
        "pieces_defected": updates.get("pieces_defected", existing.get("pieces_defected", 0)),
        "kg_used": updates.get("kg_used", existing.get("kg_used", 0)),
        "fabric_returned_kg": updates.get("fabric_returned_kg", existing.get("fabric_returned_kg", 0)),
        "cutting_waste_kg": updates.get("cutting_waste_kg", existing.get("cutting_waste_kg", 0)),
        "job_work_rate_per_piece": job_work_rate,
        "date": updates.get("date", existing.get("date")),
        "notes": packed_notes,
    }

    updated = await _update(
        store.production_returns,
        item_id,
        safe_updates,
        [
            "vendor_id",
            "order_id",
            "product_type_id",
            "pieces_received",
            "fabric_consumed_kg",
            "pieces_defected",
            "kg_used",
            "fabric_returned_kg",
            "cutting_waste_kg",
            "job_work_rate_per_piece",
            "date",
            "notes",
        ],
    )
    updated["dispatch_id"] = updated.get("order_id")
    updated["dispatch_no"] = dispatch.get("dispatch_no") or ""
    updated["vendor_name"] = dispatch.get("vendor_name") or ""
    updated["pieces_left"] = round(capacity["pieces_left"], 3)
    unpacked_notes = _unpack_return_notes(updated.get("notes") or "")
    updated["notes"] = unpacked_notes["notes"]
    updated["challan_no"] = unpacked_notes["challan_no"]
    updated["lot_no"] = unpacked_notes["lot_no"]
    updated["article_barcode"] = unpacked_notes["article_barcode"]
    updated["expected_pieces"] = round(expected_pieces, 3)
    updated["avg_fabric_per_piece"] = round(_coerce_number(unpacked_notes.get("avg_fabric_per_piece"), 0.0), 3)
    updated["fabric_still_lying_kg"] = round(_coerce_number(unpacked_notes.get("fabric_still_lying_kg"), 0.0), 3)
    updated["job_work_rate_per_piece"] = round(job_work_rate, 2)
    updated["job_work_rate"] = round(job_work_rate, 2)
    updated["job_work_amount"] = round(job_work_amount, 2)

    with SessionLocal() as session:
        return_row = session.query(ProductionReturnORM).filter(ProductionReturnORM.id == item_id).first()
        if return_row is None:
            return_row = ProductionReturnORM(
                id=item_id,
                company_id=_ensure_default_company_id(),
                vendor_id=dispatch["vendor_id"],
                order_id=next_dispatch_id,
                product_type_id=updates.get("product_type_id") or existing.get("product_type_id") or dispatch.get("product_type_id") or "dispatch-linked",
                pieces_received=int(float(next_pieces_received) if float(next_pieces_received).is_integer() else next_pieces_received),
                fabric_consumed_kg=next_fabric_consumed,
                pieces_defected=updates.get("pieces_defected", existing.get("pieces_defected", 0)),
                kg_used=updates.get("kg_used", existing.get("kg_used", 0)),
                fabric_returned_kg=updates.get("fabric_returned_kg", existing.get("fabric_returned_kg", 0)),
                cutting_waste_kg=updates.get("cutting_waste_kg", existing.get("cutting_waste_kg", 0)),
                job_work_rate_per_piece=job_work_rate,
                challan_no=str(updated.get("challan_no") or "").strip(),
                lot_no=str(updated.get("lot_no") or "").strip(),
                article_barcode=str(updated.get("article_barcode") or "").strip(),
                expected_pieces=expected_pieces,
                avg_fabric_per_piece=avg_fabric_per_piece,
                fabric_still_lying_kg=float(fabric_still_lying_kg or 0.0),
                date=datetime.fromisoformat(updated.get("date") or now_iso()) if isinstance(updated.get("date"), str) else now_utc(),
                notes=packed_notes,
                archived=False,
            )
            session.add(return_row)
        else:
            return_row.vendor_id = dispatch["vendor_id"]
            return_row.order_id = next_dispatch_id
            return_row.product_type_id = updates.get("product_type_id") or existing.get("product_type_id") or dispatch.get("product_type_id") or "dispatch-linked"
            return_row.pieces_received = int(float(next_pieces_received) if float(next_pieces_received).is_integer() else next_pieces_received)
            return_row.fabric_consumed_kg = next_fabric_consumed
            return_row.pieces_defected = updates.get("pieces_defected", existing.get("pieces_defected", 0))
            return_row.kg_used = updates.get("kg_used", existing.get("kg_kg_used", 0))
            return_row.fabric_returned_kg = updates.get("fabric_returned_kg", existing.get("fabric_returned_kg", 0))
            return_row.cutting_waste_kg = updates.get("cutting_waste_kg", existing.get("cutting_waste_kg", 0))
            return_row.job_work_rate_per_piece = job_work_rate
            return_row.challan_no = str(updated.get("challan_no") or "").strip()
            return_row.lot_no = str(updated.get("lot_no") or "").strip()
            return_row.article_barcode = str(updated.get("article_barcode") or "").strip()
            return_row.expected_pieces = expected_pieces
            return_row.avg_fabric_per_piece = avg_fabric_per_piece
            return_row.fabric_still_lying_kg = float(fabric_still_lying_kg or 0.0)
            return_row.date = datetime.fromisoformat(updated.get("date") or now_iso()) if isinstance(updated.get("date"), str) else now_utc()
            return_row.notes = packed_notes
            return_row.archived = False
        session.commit()

        if return_row is not None:
            vendor_name = session.query(VendorORM).filter(VendorORM.id == return_row.vendor_id).first()
            reference_no = str(updates.get("challan_no") if "challan_no" in updates else "").strip()
            if not reference_no:
                reference_no = unpacked_notes.get("challan_no") or f"PR-{return_row.id}"
            _upsert_production_return_payable(
                session,
                return_row,
                (vendor_name.name if vendor_name is not None else "Unknown Vendor"),
                reference_no,
                job_work_amount,
            )
            new_challan_link_id = (str(updated.get("challan_no") or "").strip() or return_row.id).lower()
            old_challan_link_id = (str(existing.get("challan_no") or _unpack_return_notes(existing.get("notes") or "").get("challan_no") or "").strip() or item_id).lower()
            if old_challan_link_id != new_challan_link_id or str(existing.get("order_id") or "") != next_dispatch_id:
                old_links = session.query(DispatchChallanLinkORM).filter(
                    DispatchChallanLinkORM.dispatch_id == str(existing.get("order_id") or ""),
                    DispatchChallanLinkORM.challan_id == old_challan_link_id,
                    DispatchChallanLinkORM.archived.isnot(True),
                ).all()
                for old_link in old_links:
                    old_link.archived = True
            existing_link = session.query(DispatchChallanLinkORM).filter(
                DispatchChallanLinkORM.dispatch_id == next_dispatch_id,
                DispatchChallanLinkORM.challan_id == new_challan_link_id,
                DispatchChallanLinkORM.archived.isnot(True),
            ).first()
            if existing_link is None:
                session.add(DispatchChallanLinkORM(
                    company_id=_ensure_default_company_id(),
                    dispatch_id=next_dispatch_id,
                    challan_id=new_challan_link_id,
                    allocated_quantity=float(updated.get("fabric_consumed_kg") or 0.0),
                    allocated_pieces=int(float(updated.get("pieces_received") or 0)),
                    archived=False,
                ))
            session.commit()

    return updated


@api_router.patch("/production-returns/{item_id}/archive")
async def archive_production_return(item_id: str, payload: ArchivePayload):
    return await _update(store.production_returns, item_id, {"archived": payload.archived}, ["archived"])


@api_router.delete("/production-returns/{item_id}")
async def delete_production_return(item_id: str):
    await _delete(store.production_returns, item_id)
    return {"ok": True}


@api_router.post("/import/production-returns")
async def import_production_returns(file: UploadFile = File(...)):
    """Columns: date,dispatch_no,pieces_received,pieces_defected,challan_no,lot_no,article_barcode,notes."""
    rows = await _read_tabular_upload(file)

    dispatches = await list_return_dispatch_options()
    dispatch_by_no = {
        str(dispatch.get("dispatch_no") or "").strip().lower(): dispatch
        for dispatch in dispatches
        if str(dispatch.get("dispatch_no") or "").strip()
    }

    created, errors = 0, []
    for i, row in enumerate(rows, start=2):
        try:
            dispatch_no = str(row.get("dispatch_no") or "").strip()
            if not dispatch_no:
                errors.append(f"Row {i}: missing dispatch_no")
                continue
            dispatch = dispatch_by_no.get(dispatch_no.lower())
            if not dispatch:
                errors.append(f"Row {i}: dispatch not found: {dispatch_no}")
                continue

            pieces_received = float(row.get("pieces_received", 0) or 0)
            if pieces_received <= 0:
                errors.append(f"Row {i}: pieces_received must be greater than zero")
                continue

            payload = ProductionReturnCreate(
                dispatch_id=dispatch["id"],
                vendor_id=dispatch.get("vendor_id"),
                product_type_id=dispatch.get("product_type_id") or "dispatch-linked",
                pieces_received=int(pieces_received) if pieces_received.is_integer() else pieces_received,
                pieces_defected=int(float(row.get("pieces_defected", 0) or 0)),
                kg_used=float(row.get("kg_used", 0) or 0),
                fabric_returned_kg=float(row.get("fabric_returned_kg", 0) or 0),
                cutting_waste_kg=float(row.get("cutting_waste_kg", 0) or 0),
                job_work_rate_per_piece=float(row.get("job_work_rate_per_piece", 0) or 0),
                date=str(row.get("date", "")).strip() or None,
                challan_no=str(row.get("challan_no", "")).strip(),
                lot_no=str(row.get("lot_no", "")).strip(),
                article_barcode=str(row.get("article_barcode", "")).strip(),
                notes=str(row.get("notes", "")).strip(),
            )
            await create_production_return(payload)
            dispatch_by_no[dispatch_no.lower()]["pieces_left"] = round(
                max(float(dispatch_by_no[dispatch_no.lower()].get("pieces_left") or 0) - pieces_received, 0),
                3,
            )
            created += 1
        except HTTPException as e:
            errors.append(f"Row {i}: {e.detail}")
        except Exception as e:
            errors.append(f"Row {i}: {e}")

    return {"created": created, "errors": errors}


@api_router.get("/export/production-returns")
async def export_production_returns(include_archived: bool = False):
    rows = await list_production_returns(include_archived=include_archived)

    try:
        import pandas as pd
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Excel export dependency error: {e}")

    export_rows = [
        {
            "Date": row.get("date"),
            "Dispatch No": row.get("dispatch_no"),
            "Vendor": row.get("vendor_name"),
            "Dispatched Pieces": row.get("dispatched_pieces"),
            "Pieces Received": row.get("pieces_received"),
            "Pieces Defected": row.get("pieces_defected"),
            "Pieces Left": row.get("pieces_left"),
            "Challan No": row.get("challan_no"),
            "Lot No": row.get("lot_no"),
            "Article Barcode": row.get("article_barcode"),
            "Notes": row.get("notes"),
            "Created At": row.get("created_at"),
        }
        for row in rows
    ]

    df = pd.DataFrame(export_rows)
    buffer = io.BytesIO()
    try:
        with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
            df.to_excel(writer, index=False, sheet_name="ProductionReturns")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate Excel file: {e}")

    buffer.seek(0)
    headers = {"Content-Disposition": "attachment; filename=production_returns.xlsx"}
    return StreamingResponse(
        buffer,
        headers=headers,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


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
    out: Dict[str, list] = {}
    for name in collection_names:
        collection = getattr(store, name)
        out[name] = await _list(collection, include_archived=False)
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
    with SessionLocal() as session:
        user = session.query(UserORM).filter(UserORM.username == payload.username.strip()).first()
    if not user or not verify_password(payload.password, user.password_hash or ""):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = create_token(user.username)
    set_auth_cookie(response, token)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"username": user.username},
    }


@api_router.post("/auth/logout")
async def logout(response: Response):
    clear_auth_cookie(response)
    return {"ok": True}


@api_router.post("/backup")
async def backup_database(user: dict = Depends(get_current_user)):
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise HTTPException(status_code=500, detail="DATABASE_URL is not configured")

    normalized_url = _normalize_postgres_url(database_url)
    if normalized_url != database_url:
        logger.info("Normalizing DATABASE_URL for pg_dump: %s -> %s", database_url, normalized_url)

    try:
        subprocess.run(["pg_dump", "--version"], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except Exception as exc:
        logger.exception("pg_dump is not available")
        raise HTTPException(status_code=500, detail=f"PostgreSQL client tools are not available: {exc}") from exc

    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M")
    filename = f"FABRITRACK_Backup_{timestamp}.sql"
    temp_file = tempfile.NamedTemporaryFile("wb", delete=False, suffix=".sql")
    temp_path = temp_file.name
    temp_file.close()

    logger.info("Starting backup with filename=%s and database_url=%s", filename, normalized_url)

    try:
        with open(temp_path, "wb") as handle:
            completed = subprocess.run(
                ["pg_dump", normalized_url, "--format=plain", "--no-owner", "--no-privileges"],
                stdout=handle,
                stderr=subprocess.PIPE,
                check=False,
            )
        if completed.returncode != 0:
            stderr = completed.stderr.decode("utf-8", errors="ignore").strip()
            logger.exception("pg_dump failed: %s", stderr or "pg_dump exited with a non-zero status")
            raise HTTPException(status_code=500, detail=stderr or f"pg_dump exited with code {completed.returncode}")

        if not os.path.exists(temp_path) or os.path.getsize(temp_path) == 0:
            raise HTTPException(status_code=500, detail="Backup file was not created")

        with open(temp_path, "rb") as handle:
            content = handle.read()

        logger.info("Backup completed successfully: filename=%s size=%s", filename, len(content))
        return Response(
            content=content,
            media_type="application/sql",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unexpected backup error")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


@api_router.post("/restore")
async def restore_database(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    if not file.filename or not file.filename.lower().endswith(".sql"):
        raise HTTPException(status_code=400, detail="Please upload a .sql backup file")

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise HTTPException(status_code=500, detail="DATABASE_URL is not configured")

    normalized_url = _normalize_postgres_url(database_url)

    try:
        subprocess.run(["psql", "--version"], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except Exception as exc:
        logger.exception("psql is not available")
        raise HTTPException(status_code=500, detail=f"PostgreSQL client tools are not available: {exc}") from exc

    temp_file = tempfile.NamedTemporaryFile("wb", delete=False, suffix=".sql")
    temp_path = temp_file.name
    temp_file.write(await file.read())
    temp_file.close()

    try:
        with open(temp_path, "rb") as handle:
            completed = subprocess.run(
                ["psql", normalized_url, "--set", "ON_ERROR_STOP=1", "--single-transaction"],
                stdin=handle,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
        if completed.returncode != 0:
            stderr = completed.stderr.decode("utf-8", errors="ignore").strip()
            logger.exception("psql restore failed: %s", stderr or "psql exited with a non-zero status")
            raise HTTPException(status_code=500, detail=stderr or f"psql exited with code {completed.returncode}")
        return {"ok": True, "message": "Database restored successfully"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unexpected restore error")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {"username": user["username"]}


@api_router.post("/auth/change-password")
async def change_password(payload: ChangePasswordPayload, user: dict = Depends(get_current_user)):
    with SessionLocal() as session:
        existing = session.query(UserORM).filter(UserORM.username == user["username"]).first()
    if not existing or not verify_password(payload.current_password, existing.password_hash or ""):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(payload.new_password) < 4:
        raise HTTPException(status_code=400, detail="New password must be at least 4 characters")
    with SessionLocal() as session:
        row = session.query(UserORM).filter(UserORM.username == user["username"]).first()
        if row is not None:
            row.password_hash = hash_password(payload.new_password)
            session.commit()
    return {"ok": True}


@api_router.post("/auth/change-username")
async def change_username(
    payload: ChangeUsernamePayload,
    response: Response,
    user: dict = Depends(get_current_user),
):
    with SessionLocal() as session:
        existing = session.query(UserORM).filter(UserORM.username == user["username"]).first()
    if not existing or not verify_password(payload.current_password, existing.password_hash or ""):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    new_u = payload.new_username.strip()
    if not new_u:
        raise HTTPException(status_code=400, detail="Username cannot be empty")
    if new_u != user["username"]:
        with SessionLocal() as session:
            clash = session.query(UserORM).filter(UserORM.username == new_u).first()
        if clash:
            raise HTTPException(status_code=400, detail="Username already taken")
    with SessionLocal() as session:
        row = session.query(UserORM).filter(UserORM.username == user["username"]).first()
        if row is not None:
            row.username = new_u
            session.commit()
    token = create_token(new_u)
    set_auth_cookie(response, token)
    return {"ok": True, "access_token": token, "user": {"username": new_u}}


# ============ APP SETTINGS ============
async def _get_settings() -> dict:
    with SessionLocal() as session:
        doc = session.query(AppSettingORM).filter(AppSettingORM.key == "app").first()
    if doc is None:
        default = {"key": "app", "app_name": "FABRITRACK", "tagline": "Manufacturing ERP", "customization_data": "{}"}
        await _create(store.app_settings, default)
        doc = default
    if isinstance(doc, dict):
        customization = _parse_customization_payload(doc.get("customization_data", "{}"))
        return {"app_name": doc.get("app_name", "FABRITRACK"), "tagline": doc.get("tagline", "Manufacturing ERP"), "customization": customization, "customization_data": json.dumps(customization)}
    customization = _parse_customization_payload(getattr(doc, "customization_data", "{}"))
    return {"app_name": getattr(doc, "app_name", "FABRITRACK"), "tagline": getattr(doc, "tagline", "Manufacturing ERP"), "customization": customization, "customization_data": json.dumps(customization)}


@api_router.get("/settings")
async def get_settings():
    return await _get_settings()


@api_router.patch("/settings")
async def update_settings(payload: AppSettingsUpdate, user: dict = Depends(get_current_user)):
    updates = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    with SessionLocal() as session:
        row = session.query(AppSettingORM).filter(AppSettingORM.key == "app").first()
        if row is None:
            row = AppSettingORM(key="app", app_name="FABRITRACK", tagline="Manufacturing ERP", customization_data="{}")
            session.add(row)
        for key, value in updates.items():
            if key == "app_name":
                row.app_name = value
            elif key == "tagline":
                row.tagline = value
            elif key == "customization_data":
                row.customization_data = json.dumps(value) if not isinstance(value, str) else value
        session.commit()
        session.refresh(row)
    return await _get_settings()


@api_router.get("/settings/customization")
async def get_customization_settings():
    return await _get_settings()


@api_router.patch("/settings/customization")
async def update_customization_settings(payload: Dict[str, Any], user: dict = Depends(get_current_user)):
    body = payload.get("customization", payload)
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Customization payload must be an object")
    with SessionLocal() as session:
        row = session.query(AppSettingORM).filter(AppSettingORM.key == "app").first()
        if row is None:
            row = AppSettingORM(key="app", app_name="FABRITRACK", tagline="Manufacturing ERP", customization_data="{}")
            session.add(row)
        row.customization_data = json.dumps(body)
        session.commit()
        session.refresh(row)
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
    with SessionLocal() as session:
        orders = session.query(OrderORM.id, OrderORM.quantity).filter(OrderORM.id.in_(order_ids)).all()
    done_by_order: Dict[str, int] = {}
    for r in returns:
        oid = r.get("order_id")
        if oid:
            done_by_order[oid] = done_by_order.get(oid, 0) + r["pieces_received"]
    return sum(max(order.quantity - done_by_order.get(order.id, 0), 0) for order in orders)


async def _ledger_txns(dispatches: list, returns: list) -> list:
    lot_ids = list({d["fabric_lot_id"] for d in dispatches})
    product_ids = list({r["product_type_id"] for r in returns})
    with SessionLocal() as session:
        lots = {lot.id: _serialize_row(FabricLotORM, lot) for lot in session.query(FabricLotORM).filter(FabricLotORM.id.in_(lot_ids)).all()}
        products = {product.id: _serialize_row(ProductTypeORM, product) for product in session.query(ProductTypeORM).filter(ProductTypeORM.id.in_(product_ids)).all()}

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
    vendor = None
    try:
        vendor = await _get(store.vendors, vendor_id)
    except HTTPException as exc:
        if exc.status_code != 404:
            raise
    with SessionLocal() as session:
        dispatch_rows = [
            row
            for row in session.query(FabricDispatchORM).filter(
                FabricDispatchORM.vendor_id == vendor_id,
                FabricDispatchORM.archived.isnot(True),
            ).order_by(FabricDispatchORM.date.desc()).all()
        ]
        dispatches = [_serialize_row(FabricDispatchORM, row) for row in dispatch_rows]
        returns = [
            _serialize_row(ProductionReturnORM, row)
            for row in session.query(ProductionReturnORM).filter(
                ProductionReturnORM.vendor_id == vendor_id,
                ProductionReturnORM.archived.isnot(True),
            ).order_by(ProductionReturnORM.date.asc(), ProductionReturnORM.created_at.asc()).all()
        ]
        lots = [
            _serialize_row(FabricLotORM, row)
            for row in session.query(FabricLotORM).filter(FabricLotORM.archived.isnot(True)).all()
        ]
        product_types = [
            _serialize_row(ProductTypeORM, row)
            for row in session.query(ProductTypeORM).filter(ProductTypeORM.archived.isnot(True)).all()
        ]
        dispatch_ids = [row.id for row in dispatch_rows]
        links = [
            {
                "dispatch_id": str(row.dispatch_id or ""),
                "challan_id": str(row.challan_id or ""),
            }
            for row in session.query(DispatchChallanLinkORM).filter(
                DispatchChallanLinkORM.dispatch_id.in_(dispatch_ids),
                DispatchChallanLinkORM.archived.isnot(True),
            ).all()
        ] if dispatch_ids else []

    dispatch_index = _build_fabric_dispatch_index(include_archived=True)
    enriched_dispatches = []
    for dispatch in dispatches:
        dispatch_id = str(dispatch.get("id") or "").strip()
        dispatch_meta = dispatch_index.get(dispatch_id, {})
        enriched_dispatch = dict(dispatch)
        enriched_dispatch["dispatch_no"] = dispatch_meta.get("dispatch_no") or dispatch.get("dispatch_no") or dispatch_id
        enriched_dispatch["expected_pieces"] = dispatch_meta.get("expected_pieces", dispatch.get("expected_pieces"))
        enriched_dispatch["avg_fabric_per_piece"] = dispatch_meta.get("avg_fabric_per_piece", dispatch.get("avg_fabric_per_piece"))
        enriched_dispatch["vendor_name"] = dispatch_meta.get("vendor_name") or dispatch.get("vendor_name") or ""
        enriched_dispatch["brand_name"] = dispatch_meta.get("brand_name") or dispatch.get("brand_name") or dispatch.get("brandName") or ""
        enriched_dispatch["product_type_name"] = dispatch_meta.get("product_type_name") or dispatch.get("product_type_name") or ""
        enriched_dispatches.append(enriched_dispatch)

    if not links:
        for row in returns:
            dispatch_id = str(row.get("dispatch_id") or row.get("order_id") or "").strip()
            challan_id = (str(row.get("challan_no") or "").strip() or str(row.get("id") or "").strip()).lower()
            if dispatch_id and challan_id:
                links.append({"dispatch_id": dispatch_id, "challan_id": challan_id})

    ledger = build_vendor_job_work_ledger(enriched_dispatches, returns, links, lots=lots, product_types=product_types)
    ledger["vendor"] = vendor
    return ledger


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
    with SessionLocal() as session:
        lots = {lot.id: _serialize_row(FabricLotORM, lot) for lot in session.query(FabricLotORM).filter(FabricLotORM.id.in_(lot_ids)).all()}
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


@api_router.get("/orders/{order_id}", response_model=Order)
async def get_order_detail(order_id: str):
    with SessionLocal() as session:
        order_row = session.query(OrderORM).filter(OrderORM.id == order_id).first()
        if order_row is None:
            raise HTTPException(status_code=404, detail="order not found")
        payload = _serialize_order(order_row)
        item_rows = session.query(OrderItemORM).filter(OrderItemORM.order_id == order_row.id, OrderItemORM.archived.is_(False)).order_by(OrderItemORM.created_at.asc()).all()
        payload["items"] = [_serialize_order_item(item_row) for item_row in item_rows]
        payload["total_product_types"] = len(payload["items"])
        payload["total_pieces"] = sum(int(item.get("quantity", 0) or 0) for item in payload["items"])
        return payload


@api_router.get("/orders/{order_id}/reconciliation")
async def order_reconciliation(order_id: str):
    order = await _get(store.orders, order_id)
    with SessionLocal() as session:
        dispatches = [
            _serialize_row(FabricDispatchORM, row)
            for row in session.query(FabricDispatchORM).filter(
                FabricDispatchORM.order_id == order_id,
                FabricDispatchORM.archived.isnot(True),
            ).all()
        ]
        returns = [
            _serialize_row(ProductionReturnORM, row)
            for row in session.query(ProductionReturnORM).filter(
                ProductionReturnORM.order_id == order_id,
                ProductionReturnORM.archived.isnot(True),
            ).all()
        ]

    recon = _reconciliation_metrics(dispatches, returns)
    avg_cost = await _avg_fabric_cost(dispatches)
    costing = _piece_costing(recon, avg_cost, returns, order)

    return {"order": order, "reconciliation": recon, "costing": costing}


# ============ CSV IMPORT ============
def _read_csv(file_bytes: bytes):
    text = file_bytes.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    return list(reader)


async def _read_tabular_upload(file: UploadFile):
    content = await file.read()
    name = (file.filename or "").lower()
    if name.endswith(".xlsx") or name.endswith(".xls"):
        try:
            import pandas as pd
            df = pd.read_excel(io.BytesIO(content))
            df = df.fillna("")
            return df.to_dict(orient="records")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid Excel file: {e}")
    try:
        return _read_csv(content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid CSV: {e}")


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
            await _create(store.fabric_lots, obj.model_dump())
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

            with SessionLocal() as session:
                buyer_row = session.query(BuyerORM).filter(BuyerORM.name == buyer_name).first()
                product_row = session.query(ProductTypeORM).filter(ProductTypeORM.name == product_name).first()
            if not buyer_row:
                buyer_obj = Buyer(name=buyer_name, type="local")
                buyer_doc = await _create(store.buyers, buyer_obj.model_dump())
            else:
                buyer_doc = _serialize_row(BuyerORM, buyer_row)

            if not product_row:
                product_obj = ProductType(name=product_name, avg_fabric_per_piece_kg=0.25)
                product_doc = await _create(store.product_types, product_obj.model_dump())
            else:
                product_doc = _serialize_row(ProductTypeORM, product_row)

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
            await _create(store.orders, obj.model_dump())
            created += 1
        except Exception as e:
            errors.append(f"Row {i}: {e}")
    return {"created": created, "errors": errors}


@api_router.post("/import/material-inventory")
async def import_material_inventory(file: UploadFile = File(...)):
    """Columns: date,material_name,supplier,quantity,unit,rate,notes (amount auto-calculated)."""
    rows = await _read_tabular_upload(file)

    created, errors = 0, []
    for i, row in enumerate(rows, start=2):
        try:
            material_name = str(row.get("material_name", "")).strip()
            supplier = str(row.get("supplier", "")).strip()
            if not material_name or not supplier:
                errors.append(f"Row {i}: missing material_name or supplier")
                continue

            quantity = float(row.get("quantity", 0) or 0)
            rate = float(row.get("rate", 0) or 0)
            if quantity <= 0:
                errors.append(f"Row {i}: quantity must be greater than zero")
                continue
            if rate <= 0:
                errors.append(f"Row {i}: rate must be greater than zero")
                continue

            payload = {
                "date": str(row.get("date", "")).strip() or now_iso(),
                "material_name": material_name,
                "supplier": supplier,
                "quantity": quantity,
                "unit": str(row.get("unit", "")).strip() or "pcs",
                "rate": rate,
                "amount": round(quantity * rate, 2),
                "notes": str(row.get("notes", "")).strip(),
            }
            obj = MaterialInventory(**payload)
            await _create(store.material_inventory, obj.model_dump())
            created += 1
        except Exception as e:
            errors.append(f"Row {i}: {e}")

    return {"created": created, "errors": errors}


@api_router.post("/import/material-dispatches")
async def import_material_dispatches(file: UploadFile = File(...)):
    """Columns: date,dispatch_no,party_name,material_name,quantity,unit,purpose,status,notes."""
    rows = await _read_tabular_upload(file)

    created, errors = 0, []
    with SessionLocal() as session:
        vendors = session.query(VendorORM).filter(VendorORM.archived.isnot(True)).all()
    vendor_by_name = {v.name.strip().lower(): v.id for v in vendors if (v.name or "").strip()}

    for i, row in enumerate(rows, start=2):
        try:
            party_name = str(
                row.get("party_name")
                or row.get("company_name")
                or row.get("vendor_name")
                or ""
            ).strip()
            material_name = str(row.get("material_name", "")).strip()
            if not party_name:
                errors.append(f"Row {i}: missing party_name / company_name / vendor_name")
                continue
            if not material_name:
                errors.append(f"Row {i}: missing material_name")
                continue

            vendor_id = vendor_by_name.get(party_name.lower())
            if not vendor_id:
                errors.append(f"Row {i}: vendor not found: {party_name}")
                continue

            quantity = float(row.get("quantity", 0) or 0)
            if quantity <= 0:
                errors.append(f"Row {i}: quantity must be greater than zero")
                continue

            payload = MaterialDispatchCreate(
                date=str(row.get("date", "")).strip() or None,
                dispatch_no=str(row.get("dispatch_no", "")).strip() or None,
                vendor_id=vendor_id,
                material_name=material_name,
                quantity=quantity,
                unit=str(row.get("unit", "")).strip() or "pcs",
                purpose=str(row.get("purpose", "")).strip(),
                status=str(row.get("status", "")).strip() or None,
                notes=str(row.get("notes", "")).strip(),
            )
            await create_material_dispatch(payload)
            created += 1
        except HTTPException as e:
            errors.append(f"Row {i}: {e.detail}")
        except Exception as e:
            errors.append(f"Row {i}: {e}")

    return {"created": created, "errors": errors}


@api_router.get("/export/material-inventory")
async def export_material_inventory(include_archived: bool = False):
    rows = await _list(store.material_inventory, include_archived)
    try:
        import pandas as pd
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Excel export dependency error: {e}")

    export_rows = [
        {
            "Date": row.get("date"),
            "Material Name": row.get("material_name"),
            "Supplier": row.get("supplier"),
            "Quantity": row.get("quantity"),
            "Unit": row.get("unit"),
            "Rate": row.get("rate"),
            "Amount": row.get("amount"),
            "Notes": row.get("notes"),
            "Created At": row.get("created_at"),
            "Updated At": row.get("updated_at"),
        }
        for row in rows
    ]

    df = pd.DataFrame(export_rows)
    buffer = io.BytesIO()
    try:
        with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
            df.to_excel(writer, index=False, sheet_name="MaterialInventory")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate Excel file: {e}")

    buffer.seek(0)
    headers = {"Content-Disposition": "attachment; filename=material_inventory.xlsx"}
    return StreamingResponse(
        buffer,
        headers=headers,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@api_router.get("/export/material-dispatches")
async def export_material_dispatches(include_archived: bool = False):
    rows = await _list(store.material_dispatches, include_archived)
    with SessionLocal() as session:
        vendors = session.query(VendorORM).all()
    vendor_map = {v.id: v.name for v in vendors}

    try:
        import pandas as pd
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Excel export dependency error: {e}")

    export_rows = [
        {
            "Date": row.get("date"),
            "Dispatch No": row.get("dispatch_no"),
            "Party / Company Name": vendor_map.get(row.get("vendor_id"), "Unknown"),
            "Material Name": row.get("material_name"),
            "Quantity": row.get("quantity"),
            "Unit": row.get("unit"),
            "Purpose": row.get("purpose"),
            "Status": row.get("status"),
            "Notes": row.get("notes"),
            "Created At": row.get("created_at"),
            "Updated At": row.get("updated_at"),
        }
        for row in rows
    ]

    df = pd.DataFrame(export_rows)
    buffer = io.BytesIO()
    try:
        with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
            df.to_excel(writer, index=False, sheet_name="MaterialDispatches")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate Excel file: {e}")

    buffer.seek(0)
    headers = {"Content-Disposition": "attachment; filename=material_dispatches.xlsx"}
    return StreamingResponse(
        buffer,
        headers=headers,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


app.include_router(api_router)

FRONTEND_BUILD_DIR = ROOT_DIR.parent / "frontend" / "build"
FRONTEND_INDEX_FILE = FRONTEND_BUILD_DIR / "index.html"


@app.get("/{full_path:path}", include_in_schema=False)
async def serve_frontend(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found")

    candidate = (FRONTEND_BUILD_DIR / full_path).resolve()
    if full_path and candidate.exists() and candidate.is_file():
        return FileResponse(candidate)

    if FRONTEND_INDEX_FILE.exists():
        return FileResponse(FRONTEND_INDEX_FILE)

    raise HTTPException(status_code=404, detail="Frontend build not found")


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://localhost:3002", "http://localhost:3003", "http://localhost:3004", "http://localhost:3005", "http://127.0.0.1:3000", "http://127.0.0.1:3001", "http://127.0.0.1:3002", "http://127.0.0.1:3003", "http://127.0.0.1:3004", "http://127.0.0.1:3005"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


ALLOWED_ORIGINS = {
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:3003",
    "http://localhost:3004",
    "http://localhost:3005",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:3002",
    "http://127.0.0.1:3003",
    "http://127.0.0.1:3004",
    "http://127.0.0.1:3005",
}

PUBLIC_PATHS = {"/api/", "/api/auth/login", "/api/auth/logout"}


def _apply_cors_headers(response: Response, request: Request) -> Response:
    origin = request.headers.get("origin")
    if origin and origin in ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type, X-Requested-With"
        response.headers["Vary"] = "Origin"
    return response


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
        response = await call_next(request)
        return _apply_cors_headers(response, request)
    # Read token from httpOnly cookie or Authorization header
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        return _apply_cors_headers(JSONResponse({"detail": "Not authenticated"}, status_code=401), request)
    try:
        jwt.decode(token, os.getenv("JWT_SECRET", "dev-secret"), algorithms=[os.getenv("JWT_ALGO", JWT_ALGO)])
    except jwt.ExpiredSignatureError:
        return _apply_cors_headers(JSONResponse({"detail": "Token expired"}, status_code=401), request)
    except jwt.InvalidTokenError:
        return _apply_cors_headers(JSONResponse({"detail": "Invalid token"}, status_code=401), request)
    response = await call_next(request)
    return _apply_cors_headers(response, request)


async def seed_admin():
    username = os.environ.get("ADMIN_USERNAME", "admin")
    password = os.environ.get("ADMIN_PASSWORD", "admin")
    expected_hash = hash_password(password)
    with SessionLocal() as session:
        existing = session.query(UserORM).filter(UserORM.username == username).first()
        if existing is None:
            session.add(UserORM(username=username, password_hash=expected_hash, company_id=_ensure_default_company_id()))
            session.commit()
            logger.info(f"Seeded admin user: {username}")
        else:
            if existing.password_hash != expected_hash:
                existing.password_hash = expected_hash
                session.commit()
    # Ensure default settings exist
    await _get_settings()


@app.on_event("shutdown")
async def shutdown_db_client():
    pass


if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=False)

