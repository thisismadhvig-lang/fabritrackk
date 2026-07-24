from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func, or_

from database import SessionLocal, init_db
from models import (
    ArticleORM,
    BrandORM,
    CompanyORM,
    FabricDispatchORM,
    FabricLotORM,
    InventoryMovementORM,
    ItemCatalogORM,
    OrderORM,
    PartyORM,
    ProductTypeORM,
    ProductionReturnORM,
    UnitORM,
    WarehouseORM,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _get_company(session) -> CompanyORM:
    init_db()
    company = session.query(CompanyORM).filter(CompanyORM.code == "FT").first()
    if company is None:
        company = CompanyORM(name="FabriTrack", code="FT", contact_email="ops@fabrik.com", contact_phone="1234")
        session.add(company)
        session.flush()
        unit = UnitORM(company_id=company.id, name="KG", symbol="kg")
        warehouse = WarehouseORM(company_id=company.id, name="Main Warehouse", code="WH-001")
        session.add_all([unit, warehouse])
        session.flush()
    return company


def _get_or_create_unit(session, company: CompanyORM) -> UnitORM:
    unit = session.query(UnitORM).filter(UnitORM.company_id == company.id, UnitORM.symbol == "kg").first()
    if unit is None:
        unit = UnitORM(company_id=company.id, name="KG", symbol="kg")
        session.add(unit)
        session.flush()
    return unit


def _get_or_create_warehouse(session, company: CompanyORM) -> WarehouseORM:
    warehouse = session.query(WarehouseORM).filter(WarehouseORM.company_id == company.id, WarehouseORM.code == "WH-001").first()
    if warehouse is None:
        warehouse = WarehouseORM(company_id=company.id, name="Main Warehouse", code="WH-001")
        session.add(warehouse)
        session.flush()
    return warehouse


def _get_or_create_item(session, company: CompanyORM, code: str, name: str, *, item_type: str, unit: UnitORM) -> ItemCatalogORM:
    item = session.query(ItemCatalogORM).filter(ItemCatalogORM.company_id == company.id, ItemCatalogORM.code == code).first()
    if item is None:
        item = ItemCatalogORM(company_id=company.id, code=code, name=name, item_type=item_type, default_unit_id=unit.id)
        session.add(item)
        session.flush()
    return item


def _create_inventory_movement(session, *, company: CompanyORM, item: ItemCatalogORM, warehouse: WarehouseORM, movement_type: str, quantity: float, reference_type: str = "", reference_id: str = "", remarks: str = "") -> InventoryMovementORM:
    unit = session.query(UnitORM).filter(UnitORM.id == item.default_unit_id).first() if item.default_unit_id else None
    movement = InventoryMovementORM(
        company_id=company.id,
        item_id=item.id,
        warehouse_id=warehouse.id,
        movement_type=movement_type,
        quantity=quantity,
        unit_id=unit.id if unit else None,
        reference_type=reference_type,
        reference_id=reference_id,
        remarks=remarks,
    )
    session.add(movement)
    session.flush()
    return movement


def _balance_for_item(session, item_id: str, warehouse_id: str | None = None) -> float:
    query = session.query(func.coalesce(func.sum(InventoryMovementORM.quantity), 0.0)).filter(InventoryMovementORM.item_id == item_id)
    if warehouse_id:
        query = query.filter(InventoryMovementORM.warehouse_id == warehouse_id)
    return float(query.scalar() or 0.0)


def _serialize_party(row: PartyORM) -> Dict[str, Any]:
    return {
        "id": row.id,
        "name": row.name,
        "contact": row.contact_name or row.email or row.phone or "",
        "country": row.address or "",
        "type": "export" if row.address and "export" in row.address.lower() else "local",
        "archived": row.archived,
        "created_at": row.created_at.isoformat() if row.created_at else "",
    }


def _serialize_vendor(row: PartyORM) -> Dict[str, Any]:
    return {
        "id": row.id,
        "name": row.name,
        "type": "own" if row.code == "own" else "third_party",
        "contact": row.contact_name or row.email or row.phone or "",
        "location": row.address or "",
        "archived": row.archived,
        "created_at": row.created_at.isoformat() if row.created_at else "",
    }


def _serialize_product_type(row: ProductTypeORM) -> Dict[str, Any]:
    return {
        "id": row.id,
        "name": row.name,
        "avg_fabric_per_piece_kg": row.avg_fabric_per_piece_kg,
        "description": row.description,
        "archived": row.archived,
        "created_at": row.created_at.isoformat() if row.created_at else "",
    }


def _serialize_brand(row: BrandORM) -> Dict[str, Any]:
    return {
        "id": row.id,
        "name": row.name,
        "description": row.description,
        "archived": row.archived,
        "created_at": row.created_at.isoformat() if row.created_at else "",
    }


def _serialize_article(row: ArticleORM) -> Dict[str, Any]:
    return {
        "id": row.id,
        "brand_id": row.brand_id,
        "name": row.name,
        "description": row.description,
        "archived": row.archived,
        "created_at": row.created_at.isoformat() if row.created_at else "",
    }


def _serialize_fabric_lot(row: FabricLotORM, *, remaining: Optional[float] = None) -> Dict[str, Any]:
    return {
        "id": row.id,
        "fabric_type": row.fabric_type,
        "color": row.color,
        "supplier": row.supplier,
        "kg_received": row.kg_received,
        "kg_dispatched": row.kg_dispatched,
        "kg_remaining": remaining if remaining is not None else max(row.kg_received - row.kg_dispatched, 0.0),
        "cost_per_kg": row.cost_per_kg,
        "date_received": row.date_received.isoformat() if row.date_received else "",
        "notes": row.notes,
        "archived": row.archived,
        "created_at": row.created_at.isoformat() if row.created_at else "",
    }


def _serialize_fabric_dispatch(row: FabricDispatchORM) -> Dict[str, Any]:
    return {
        "id": row.id,
        "fabric_lot_id": row.fabric_lot_id,
        "vendor_id": row.vendor_id,
        "order_id": row.order_id,
        "product_type_id": row.product_type_id,
        "kg_dispatched": row.kg_dispatched,
        "date": row.date.isoformat() if row.date else "",
        "notes": row.notes,
        "archived": row.archived,
        "created_at": row.created_at.isoformat() if row.created_at else "",
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
        "order_date": row.order_date.isoformat() if row.order_date else "",
        "delivery_date": row.delivery_date.isoformat() if row.delivery_date else None,
        "notes": row.notes,
        "archived": row.archived,
        "created_at": row.created_at.isoformat() if row.created_at else "",
    }


def _serialize_production_return(row: ProductionReturnORM) -> Dict[str, Any]:
    return {
        "id": row.id,
        "vendor_id": row.vendor_id,
        "order_id": row.order_id,
        "product_type_id": row.product_type_id,
        "pieces_received": row.pieces_received,
        "pieces_defected": row.pieces_defected,
        "kg_used": row.kg_used,
        "fabric_returned_kg": row.fabric_returned_kg,
        "cutting_waste_kg": row.cutting_waste_kg,
        "job_work_rate_per_piece": row.job_work_rate_per_piece,
        "date": row.date.isoformat() if row.date else "",
        "notes": row.notes,
        "archived": row.archived,
        "created_at": row.created_at.isoformat() if row.created_at else "",
    }


def create_buyer(payload: Dict[str, Any]) -> Dict[str, Any]:
    with SessionLocal() as session:
        company = _get_company(session)
        party = PartyORM(company_id=company.id, party_type="buyer", name=payload["name"], contact_name=payload.get("contact", ""), address=payload.get("country", ""), archived=False)
        session.add(party)
        session.flush()
        session.commit()
        return _serialize_party(party)


def list_buyers(include_archived: bool = False) -> List[Dict[str, Any]]:
    with SessionLocal() as session:
        query = session.query(PartyORM).filter(PartyORM.party_type == "buyer")
        if not include_archived:
            query = query.filter(PartyORM.archived.is_(False))
        rows = query.order_by(PartyORM.created_at.desc()).all()
        return [_serialize_party(row) for row in rows]


def update_buyer(item_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
    with SessionLocal() as session:
        row = session.query(PartyORM).filter(PartyORM.id == item_id).first()
        if row is None:
            raise ValueError("buyer not found")
        if "name" in updates:
            row.name = updates["name"]
        if "contact" in updates:
            row.contact_name = updates["contact"]
        if "country" in updates:
            row.address = updates["country"]
        if "type" in updates:
            row.code = updates["type"]
        session.commit()
        session.refresh(row)
        return _serialize_party(row)


def archive_buyer(item_id: str, archived: bool) -> Dict[str, Any]:
    with SessionLocal() as session:
        row = session.query(PartyORM).filter(PartyORM.id == item_id).first()
        if row is None:
            raise ValueError("buyer not found")
        row.archived = archived
        session.commit()
        session.refresh(row)
        return _serialize_party(row)


def create_vendor(payload: Dict[str, Any]) -> Dict[str, Any]:
    with SessionLocal() as session:
        company = _get_company(session)
        row = PartyORM(company_id=company.id, party_type="vendor", name=payload["name"], contact_name=payload.get("contact", ""), address=payload.get("location", ""), code=payload.get("type", "third_party"), archived=False)
        session.add(row)
        session.flush()
        session.commit()
        return _serialize_vendor(row)


def list_vendors(include_archived: bool = False) -> List[Dict[str, Any]]:
    with SessionLocal() as session:
        query = session.query(PartyORM).filter(PartyORM.party_type == "vendor")
        if not include_archived:
            query = query.filter(PartyORM.archived.is_(False))
        rows = query.order_by(PartyORM.created_at.desc()).all()
        return [_serialize_vendor(row) for row in rows]


def update_vendor(item_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
    with SessionLocal() as session:
        row = session.query(PartyORM).filter(PartyORM.id == item_id).first()
        if row is None:
            raise ValueError("vendor not found")
        if "name" in updates:
            row.name = updates["name"]
        if "contact" in updates:
            row.contact_name = updates["contact"]
        if "location" in updates:
            row.address = updates["location"]
        if "type" in updates:
            row.code = updates["type"]
        session.commit()
        session.refresh(row)
        return _serialize_vendor(row)


def archive_vendor(item_id: str, archived: bool) -> Dict[str, Any]:
    with SessionLocal() as session:
        row = session.query(PartyORM).filter(PartyORM.id == item_id).first()
        if row is None:
            raise ValueError("vendor not found")
        row.archived = archived
        session.commit()
        session.refresh(row)
        return _serialize_vendor(row)


def create_product_type(payload: Dict[str, Any]) -> Dict[str, Any]:
    with SessionLocal() as session:
        company = _get_company(session)
        row = ProductTypeORM(company_id=company.id, name=payload["name"], avg_fabric_per_piece_kg=payload.get("avg_fabric_per_piece_kg", 0.25), description=payload.get("description", ""), archived=False)
        session.add(row)
        session.flush()
        session.commit()
        return _serialize_product_type(row)


def list_product_types(include_archived: bool = False) -> List[Dict[str, Any]]:
    with SessionLocal() as session:
        query = session.query(ProductTypeORM)
        if not include_archived:
            query = query.filter(ProductTypeORM.archived.is_(False))
        rows = query.order_by(ProductTypeORM.created_at.desc()).all()
        return [_serialize_product_type(row) for row in rows]


def update_product_type(item_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
    with SessionLocal() as session:
        row = session.query(ProductTypeORM).filter(ProductTypeORM.id == item_id).first()
        if row is None:
            raise ValueError("product type not found")
        if "name" in updates:
            row.name = updates["name"]
        if "avg_fabric_per_piece_kg" in updates:
            row.avg_fabric_per_piece_kg = updates["avg_fabric_per_piece_kg"]
        if "description" in updates:
            row.description = updates["description"]
        session.commit()
        session.refresh(row)
        return _serialize_product_type(row)


def archive_product_type(item_id: str, archived: bool) -> Dict[str, Any]:
    with SessionLocal() as session:
        row = session.query(ProductTypeORM).filter(ProductTypeORM.id == item_id).first()
        if row is None:
            raise ValueError("product type not found")
        row.archived = archived
        session.commit()
        session.refresh(row)
        return _serialize_product_type(row)


def create_brand(payload: Dict[str, Any]) -> Dict[str, Any]:
    with SessionLocal() as session:
        company = _get_company(session)
        row = BrandORM(company_id=company.id, name=payload["name"], description=payload.get("description", ""), archived=False)
        session.add(row)
        session.flush()
        session.commit()
        return _serialize_brand(row)


def list_brands(include_archived: bool = False) -> List[Dict[str, Any]]:
    with SessionLocal() as session:
        query = session.query(BrandORM)
        if not include_archived:
            query = query.filter(BrandORM.archived.is_(False))
        rows = query.order_by(BrandORM.created_at.desc()).all()
        return [_serialize_brand(row) for row in rows]


def create_article(payload: Dict[str, Any]) -> Dict[str, Any]:
    with SessionLocal() as session:
        company = _get_company(session)
        row = ArticleORM(company_id=company.id, brand_id=payload["brand_id"], name=payload["name"], description=payload.get("description", ""), archived=False)
        session.add(row)
        session.flush()
        session.commit()
        return _serialize_article(row)


def list_articles(include_archived: bool = False) -> List[Dict[str, Any]]:
    with SessionLocal() as session:
        query = session.query(ArticleORM)
        if not include_archived:
            query = query.filter(ArticleORM.archived.is_(False))
        rows = query.order_by(ArticleORM.created_at.desc()).all()
        return [_serialize_article(row) for row in rows]


def create_warehouse(payload: Dict[str, Any]) -> Dict[str, Any]:
    with SessionLocal() as session:
        company = _get_company(session)
        row = WarehouseORM(company_id=company.id, name=payload["name"], code=payload.get("code", payload["name"].upper()[:6]), location=payload.get("location", ""), warehouse_type=payload.get("warehouse_type", "general"), archived=False)
        session.add(row)
        session.flush()
        session.commit()
        return {"id": row.id, "name": row.name, "code": row.code, "location": row.location, "warehouse_type": row.warehouse_type, "archived": row.archived}


def list_warehouses(include_archived: bool = False) -> List[Dict[str, Any]]:
    with SessionLocal() as session:
        query = session.query(WarehouseORM)
        if not include_archived:
            query = query.filter(WarehouseORM.archived.is_(False))
        rows = query.order_by(WarehouseORM.created_at.desc()).all()
        return [{"id": row.id, "name": row.name, "code": row.code, "location": row.location, "warehouse_type": row.warehouse_type, "archived": row.archived} for row in rows]


def create_unit(payload: Dict[str, Any]) -> Dict[str, Any]:
    with SessionLocal() as session:
        company = _get_company(session)
        row = UnitORM(company_id=company.id, name=payload["name"], symbol=payload.get("symbol", payload["name"].lower()[:3]), archived=False)
        session.add(row)
        session.flush()
        session.commit()
        return {"id": row.id, "name": row.name, "symbol": row.symbol, "archived": row.archived}


def list_units(include_archived: bool = False) -> List[Dict[str, Any]]:
    with SessionLocal() as session:
        query = session.query(UnitORM)
        if not include_archived:
            query = query.filter(UnitORM.archived.is_(False))
        rows = query.order_by(UnitORM.created_at.desc()).all()
        return [{"id": row.id, "name": row.name, "symbol": row.symbol, "archived": row.archived} for row in rows]


def create_fabric_lot(payload: Dict[str, Any]) -> Dict[str, Any]:
    with SessionLocal() as session:
        company = _get_company(session)
        unit = _get_or_create_unit(session, company)
        warehouse = _get_or_create_warehouse(session, company)
        item = _get_or_create_item(session, company, code=f"FAB-{payload['fabric_type'].upper()[:6]}", name=payload["fabric_type"], item_type="fabric", unit=unit)
        row = FabricLotORM(
            company_id=company.id,
            fabric_type=payload["fabric_type"],
            color=payload.get("color", ""),
            supplier=payload.get("supplier", ""),
            kg_received=float(payload.get("kg_received", 0) or 0),
            cost_per_kg=float(payload.get("cost_per_kg", 0) or 0),
            date_received=payload.get("date_received") and datetime.fromisoformat(payload["date_received"])
            or _now(),
            notes=payload.get("notes", ""),
            archived=False,
        )
        session.add(row)
        session.flush()
        _create_inventory_movement(session, company=company, item=item, warehouse=warehouse, movement_type="receipt", quantity=row.kg_received, reference_type="fabric_lot", reference_id=row.id, remarks=row.fabric_type)
        session.commit()
        session.refresh(row)
        return _serialize_fabric_lot(row, remaining=max(row.kg_received - row.kg_dispatched, 0.0))


def list_fabric_lots(include_archived: bool = False) -> List[Dict[str, Any]]:
    with SessionLocal() as session:
        query = session.query(FabricLotORM)
        if not include_archived:
            query = query.filter(FabricLotORM.archived.is_(False))
        rows = query.order_by(FabricLotORM.created_at.desc()).all()
        results: List[Dict[str, Any]] = []
        for row in rows:
            dispatched = session.query(func.coalesce(func.sum(FabricDispatchORM.kg_dispatched), 0.0)).filter(FabricDispatchORM.fabric_lot_id == row.id, FabricDispatchORM.archived.is_(False)).scalar() or 0.0
            row.kg_dispatched = float(dispatched)
            results.append(_serialize_fabric_lot(row, remaining=max(row.kg_received - float(dispatched), 0.0)))
        return results


def update_fabric_lot(item_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
    with SessionLocal() as session:
        row = session.query(FabricLotORM).filter(FabricLotORM.id == item_id).first()
        if row is None:
            raise ValueError("fabric lot not found")
        if "fabric_type" in updates:
            row.fabric_type = updates["fabric_type"]
        if "color" in updates:
            row.color = updates["color"]
        if "supplier" in updates:
            row.supplier = updates["supplier"]
        if "kg_received" in updates:
            row.kg_received = float(updates["kg_received"] or 0)
        if "cost_per_kg" in updates:
            row.cost_per_kg = float(updates["cost_per_kg"] or 0)
        if "date_received" in updates and updates["date_received"]:
            row.date_received = datetime.fromisoformat(updates["date_received"])
        if "notes" in updates:
            row.notes = updates["notes"]
        session.commit()
        session.refresh(row)
        return _serialize_fabric_lot(row, remaining=max(row.kg_received - row.kg_dispatched, 0.0))


def archive_fabric_lot(item_id: str, archived: bool) -> Dict[str, Any]:
    with SessionLocal() as session:
        row = session.query(FabricLotORM).filter(FabricLotORM.id == item_id).first()
        if row is None:
            raise ValueError("fabric lot not found")
        row.archived = archived
        session.commit()
        session.refresh(row)
        return _serialize_fabric_lot(row, remaining=max(row.kg_received - row.kg_dispatched, 0.0))


def create_fabric_dispatch(payload: Dict[str, Any]) -> Dict[str, Any]:
    with SessionLocal() as session:
        company = _get_company(session)
        lot = session.query(FabricLotORM).filter(FabricLotORM.id == payload["fabric_lot_id"]).first()
        if lot is None:
            raise ValueError("fabric lot not found")
        dispatched = session.query(func.coalesce(func.sum(FabricDispatchORM.kg_dispatched), 0.0)).filter(FabricDispatchORM.fabric_lot_id == lot.id, FabricDispatchORM.archived.is_(False)).scalar() or 0.0
        remaining = lot.kg_received - float(dispatched)
        requested = float(payload.get("kg_dispatched", 0) or 0)
        if requested > remaining + 0.001:
            raise ValueError(f"Only {remaining:.3f} kg remaining")
        row = FabricDispatchORM(
            company_id=company.id,
            fabric_lot_id=lot.id,
            vendor_id=payload.get("vendor_id"),
            order_id=payload.get("order_id"),
            product_type_id=payload.get("product_type_id"),
            kg_dispatched=requested,
            date=payload.get("date") and datetime.fromisoformat(payload["date"]) or _now(),
            notes=payload.get("notes", ""),
            archived=False,
        )
        session.add(row)
        session.flush()
        item = session.query(ItemCatalogORM).filter(ItemCatalogORM.company_id == company.id, ItemCatalogORM.code == f"FAB-{lot.fabric_type.upper()[:6]}").first()
        warehouse = _get_or_create_warehouse(session, company)
        if item:
            _create_inventory_movement(session, company=company, item=item, warehouse=warehouse, movement_type="dispatch", quantity=-requested, reference_type="fabric_dispatch", reference_id=row.id, remarks=lot.fabric_type)
        session.commit()
        session.refresh(row)
        return _serialize_fabric_dispatch(row)


def list_fabric_dispatches(include_archived: bool = False) -> List[Dict[str, Any]]:
    with SessionLocal() as session:
        query = session.query(FabricDispatchORM)
        if not include_archived:
            query = query.filter(FabricDispatchORM.archived.is_(False))
        rows = query.order_by(FabricDispatchORM.created_at.desc()).all()
        return [_serialize_fabric_dispatch(row) for row in rows]


def create_order(payload: Dict[str, Any]) -> Dict[str, Any]:
    with SessionLocal() as session:
        company = _get_company(session)
        row = OrderORM(
            company_id=company.id,
            order_number=payload["order_number"],
            buyer_id=payload["buyer_id"],
            product_type_id=payload["product_type_id"],
            quantity=int(payload.get("quantity", 0) or 0),
            unit_price=float(payload.get("unit_price", 0) or 0),
            stage=payload.get("stage", "order_received"),
            order_date=payload.get("order_date") and datetime.fromisoformat(payload["order_date"]) or _now(),
            delivery_date=payload.get("delivery_date") and datetime.fromisoformat(payload["delivery_date"]) or None,
            notes=payload.get("notes", ""),
            archived=False,
        )
        session.add(row)
        session.flush()
        session.commit()
        return _serialize_order(row)


def list_orders(include_archived: bool = False) -> List[Dict[str, Any]]:
    with SessionLocal() as session:
        query = session.query(OrderORM)
        if not include_archived:
            query = query.filter(OrderORM.archived.is_(False))
        rows = query.order_by(OrderORM.created_at.desc()).all()
        return [_serialize_order(row) for row in rows]


def update_order(item_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
    with SessionLocal() as session:
        row = session.query(OrderORM).filter(OrderORM.id == item_id).first()
        if row is None:
            raise ValueError("order not found")
        for field in ["order_number", "buyer_id", "product_type_id", "quantity", "unit_price", "stage", "notes"]:
            if field in updates:
                setattr(row, field, updates[field])
        if "order_date" in updates and updates["order_date"]:
            row.order_date = datetime.fromisoformat(updates["order_date"])
        if "delivery_date" in updates and updates["delivery_date"]:
            row.delivery_date = datetime.fromisoformat(updates["delivery_date"])
        session.commit()
        session.refresh(row)
        return _serialize_order(row)


def create_production_return(payload: Dict[str, Any]) -> Dict[str, Any]:
    with SessionLocal() as session:
        company = _get_company(session)
        row = ProductionReturnORM(
            company_id=company.id,
            vendor_id=payload["vendor_id"],
            order_id=payload.get("order_id"),
            product_type_id=payload["product_type_id"],
            pieces_received=int(payload.get("pieces_received", 0) or 0),
            pieces_defected=int(payload.get("pieces_defected", 0) or 0),
            kg_used=float(payload.get("kg_used", 0) or 0),
            fabric_returned_kg=float(payload.get("fabric_returned_kg", 0) or 0),
            cutting_waste_kg=float(payload.get("cutting_waste_kg", 0) or 0),
            job_work_rate_per_piece=float(payload.get("job_work_rate_per_piece", 0) or 0),
            date=payload.get("date") and datetime.fromisoformat(payload["date"]) or _now(),
            notes=payload.get("notes", ""),
            archived=False,
        )
        session.add(row)
        session.flush()
        session.commit()
        return _serialize_production_return(row)


def list_production_returns(include_archived: bool = False) -> List[Dict[str, Any]]:
    with SessionLocal() as session:
        query = session.query(ProductionReturnORM)
        if not include_archived:
            query = query.filter(ProductionReturnORM.archived.is_(False))
        rows = query.order_by(ProductionReturnORM.created_at.desc()).all()
        return [_serialize_production_return(row) for row in rows]


def build_dashboard_summary() -> Dict[str, Any]:
    with SessionLocal() as session:
        lots = session.query(FabricLotORM).filter(FabricLotORM.archived.is_(False)).all()
        dispatches = session.query(FabricDispatchORM).filter(FabricDispatchORM.archived.is_(False)).all()
        returns = session.query(ProductionReturnORM).filter(ProductionReturnORM.archived.is_(False)).all()
        orders = session.query(OrderORM).filter(OrderORM.archived.is_(False)).all()
        vendors = session.query(PartyORM).filter(PartyORM.party_type == "vendor", PartyORM.archived.is_(False)).all()
        product_types = session.query(ProductTypeORM).filter(ProductTypeORM.archived.is_(False)).all()

        total_received = sum(l.kg_received for l in lots)
        total_dispatched = sum(d.kg_dispatched for d in dispatches)
        total_used = sum(r.kg_used for r in returns)
        total_pieces = sum(r.pieces_received for r in returns)
        total_defected = sum(r.pieces_defected for r in returns)

        vendor_stats: List[Dict[str, Any]] = []
        for vendor in vendors:
            vendor_dispatch = sum(d.kg_dispatched for d in dispatches if d.vendor_id == vendor.id)
            vendor_returns = [r for r in returns if r.vendor_id == vendor.id]
            vendor_stats.append(
                {
                    "vendor": vendor.name,
                    "kg_dispatched": round(vendor_dispatch, 3),
                    "pieces_received": sum(r.pieces_received for r in vendor_returns),
                    "pieces_defected": sum(r.pieces_defected for r in vendor_returns),
                }
            )

        fabric_by_type: List[Dict[str, Any]] = []
        by_type: Dict[str, float] = {}
        for lot in lots:
            by_type[lot.fabric_type] = by_type.get(lot.fabric_type, 0.0) + lot.kg_received
        for key, value in sorted(by_type.items()):
            fabric_by_type.append({"fabric_type": key, "kg": round(value, 3)})

        product_stats: List[Dict[str, Any]] = []
        for product in product_types:
            product_returns = [r for r in returns if r.product_type_id == product.id]
            product_stats.append(
                {
                    "product": product.name,
                    "pieces_received": sum(r.pieces_received for r in product_returns),
                    "pieces_defected": sum(r.pieces_defected for r in product_returns),
                    "kg_used": round(sum(r.kg_used for r in product_returns), 3),
                }
            )

        stage_counts = {stage: 0 for stage in ["order_received", "sampling", "buyer_approval", "fabric_purchase", "fabric_received", "cutting", "printing", "stitching", "washing", "finishing", "quality_check", "packing", "warehouse", "shipment"]}
        for order in orders:
            stage_counts[order.stage] = stage_counts.get(order.stage, 0) + 1

        return {
            "kpi": {
                "total_kg_received": round(total_received, 3),
                "total_kg_dispatched": round(total_dispatched, 3),
                "total_kg_remaining": round(max(total_received - total_dispatched, 0.0), 3),
                "total_kg_used": round(total_used, 3),
                "total_pieces_received": total_pieces,
                "total_pieces_defected": total_defected,
                "avg_fabric_per_piece_kg": round(total_used / total_pieces, 4) if total_pieces else 0.0,
                "defect_rate_pct": round((total_defected / total_pieces) * 100, 2) if total_pieces else 0.0,
                "total_orders": len(orders),
                "total_vendors": len(vendors),
            },
            "vendor_stats": vendor_stats,
            "fabric_by_type": fabric_by_type,
            "product_stats": product_stats,
            "stage_funnel": [{"stage": stage, "count": stage_counts[stage]} for stage in stage_counts],
        }


def build_vendor_ledger(vendor_id: str) -> Dict[str, Any]:
    with SessionLocal() as session:
        vendor = session.query(PartyORM).filter(PartyORM.id == vendor_id).first()
        if vendor is None:
            raise ValueError("vendor not found")
        dispatches = session.query(FabricDispatchORM).filter(FabricDispatchORM.vendor_id == vendor_id, FabricDispatchORM.archived.is_(False)).all()
        returns = session.query(ProductionReturnORM).filter(ProductionReturnORM.vendor_id == vendor_id, ProductionReturnORM.archived.is_(False)).all()
        summary = {
            "total_fabric_received_kg": round(sum(d.kg_dispatched for d in dispatches), 3),
            "total_fabric_consumed_kg": round(sum(r.kg_used for r in returns), 3),
            "total_fabric_returned_kg": round(sum(r.fabric_returned_kg for r in returns), 3),
            "total_cutting_waste_kg": round(sum(r.cutting_waste_kg for r in returns), 3),
            "total_pieces_produced": sum(r.pieces_received for r in returns),
            "total_defected_pieces": sum(r.pieces_defected for r in returns),
            "avg_fabric_per_piece_kg": round(sum(r.kg_used for r in returns) / sum(r.pieces_received for r in returns), 4) if sum(r.pieces_received for r in returns) else 0.0,
            "fabric_lying_with_factory_kg": round(max(sum(d.kg_dispatched for d in dispatches) - sum(r.kg_used for r in returns) - sum(r.fabric_returned_kg for r in returns) - sum(r.cutting_waste_kg for r in returns), 0.0), 3),
            "job_work_charges_payable": round(sum(r.pieces_received * r.job_work_rate_per_piece for r in returns), 2),
        }
        order_ids = [d.order_id for d in dispatches if d.order_id]
        orders = session.query(OrderORM).filter(OrderORM.id.in_(order_ids)).all() if order_ids else []
        done_by_order: Dict[str, int] = {}
        for item in returns:
            if item.order_id:
                done_by_order[item.order_id] = done_by_order.get(item.order_id, 0) + item.pieces_received
        pending_pieces = sum(max(o.quantity - done_by_order.get(o.id, 0), 0) for o in orders)
        summary["pieces_pending_return"] = pending_pieces
        transactions = []
        for dispatch in dispatches:
            transactions.append({"id": dispatch.id, "date": dispatch.date.isoformat() if dispatch.date else "", "type": "dispatch_out", "description": "Fabric issued", "kg": dispatch.kg_dispatched, "pieces": 0, "amount": 0.0, "order_id": dispatch.order_id})
        for item in returns:
            transactions.append({"id": item.id, "date": item.date.isoformat() if item.date else "", "type": "production_return", "description": f"Return: {item.pieces_received} pcs", "kg": item.kg_used, "pieces": item.pieces_received, "amount": round(item.pieces_received * item.job_work_rate_per_piece, 2), "order_id": item.order_id})
        transactions.sort(key=lambda x: x["date"] or "", reverse=True)
        return {"vendor": {"id": vendor.id, "name": vendor.name}, "summary": summary, "transactions": transactions}


def build_order_reconciliation(order_id: str) -> Dict[str, Any]:
    with SessionLocal() as session:
        order = session.query(OrderORM).filter(OrderORM.id == order_id).first()
        if order is None:
            raise ValueError("order not found")
        dispatches = session.query(FabricDispatchORM).filter(FabricDispatchORM.order_id == order_id, FabricDispatchORM.archived.is_(False)).all()
        returns = session.query(ProductionReturnORM).filter(ProductionReturnORM.order_id == order_id, ProductionReturnORM.archived.is_(False)).all()
        issued = sum(d.kg_dispatched for d in dispatches)
        consumed = sum(r.kg_used for r in returns)
        returned_unused = sum(r.fabric_returned_kg for r in returns)
        waste = sum(r.cutting_waste_kg for r in returns)
        pieces = sum(r.pieces_received for r in returns)
        defected = sum(r.pieces_defected for r in returns)
        return {
            "order": _serialize_order(order),
            "reconciliation": {
                "fabric_issued_kg": round(issued, 3),
                "fabric_consumed_kg": round(consumed, 3),
                "fabric_returned_unused_kg": round(returned_unused, 3),
                "cutting_waste_kg": round(waste, 3),
                "unaccounted_loss_kg": round(max(issued - consumed - returned_unused - waste, 0.0), 3),
                "finished_pieces": pieces,
                "defected_pieces": defected,
                "avg_kg_per_piece": round(consumed / pieces, 4) if pieces else 0.0,
            },
            "costing": {
                "avg_fabric_cost_per_kg": 0.0,
                "fabric_cost_used": round(consumed * 0.0, 2),
                "job_work_cost": round(sum(r.pieces_received * r.job_work_rate_per_piece for r in returns), 2),
                "total_production_cost": round(sum(r.pieces_received * r.job_work_rate_per_piece for r in returns), 2),
                "cost_per_piece": round(sum(r.pieces_received * r.job_work_rate_per_piece for r in returns) / pieces, 2) if pieces else 0.0,
                "unit_price": order.unit_price,
                "expected_revenue": round(order.unit_price * order.quantity, 2),
                "margin_per_piece": round(order.unit_price - (sum(r.pieces_received * r.job_work_rate_per_piece for r in returns) / pieces if pieces else 0.0), 2),
            },
        }
