import json
from typing import Any, Dict, List


def _coerce_number(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def _payment_status(total_amount: float, paid_amount: float) -> str:
    if paid_amount <= 0:
        return "Pending"
    if paid_amount >= total_amount:
        return "Settled"
    return "Partly Paid"


def _payment_status_for_source(total_amount: float, paid_amount: float, source: str) -> str:
    if source == "payables":
        if paid_amount <= 0:
            return "Pending"
        if paid_amount >= total_amount:
            return "Paid"
        return "Partial"
    if paid_amount <= 0:
        return "Pending"
    if paid_amount >= total_amount:
        return "Received"
    return "Partial"


def _extract_return_expected_pieces(row: Dict[str, Any]) -> float:
    value = row.get("expected_pieces")
    if value in (None, ""):
        notes = row.get("notes") or ""
        if isinstance(notes, str) and notes.strip():
            try:
                parsed = json.loads(notes)
            except Exception:
                parsed = None
            if isinstance(parsed, dict):
                value = parsed.get("expected_pieces")
    return _coerce_number(value, 0.0)


def _resolve_expected_pieces(dispatch: Dict[str, Any], related_returns: List[Dict[str, Any]]) -> int:
    receipt_values = [_coerce_number(_extract_return_expected_pieces(row), 0.0) for row in related_returns if _coerce_number(_extract_return_expected_pieces(row), 0.0) > 0]
    if receipt_values:
        return int(max(receipt_values))
    dispatch_value = _coerce_number(dispatch.get("expected_pieces"), 0.0)
    return int(dispatch_value) if dispatch_value > 0 else 0


def build_material_ledger(inventory_rows: List[Dict[str, Any]], dispatch_rows: List[Dict[str, Any]], payables: List[Dict[str, Any]], receivables: List[Dict[str, Any]], vendor_lookup: Dict[str, Any] | None = None) -> Dict[str, Any]:
    payable_lookup = {}
    for item in payables:
        note = str(item.get("notes") or "")
        if "material_inventory_id:" in note:
            token = note.split("material_inventory_id:", 1)[1].split()[0].split("|")[0]
            payable_lookup[token] = item

    receivable_lookup = {}
    for item in receivables:
        note = str(item.get("notes") or "")
        if "material_dispatch_id:" in note:
            token = note.split("material_dispatch_id:", 1)[1].split()[0].split("|")[0]
            receivable_lookup[token] = item

    allocation_map: Dict[str, float] = {}
    for dispatch in dispatch_rows:
        for allocation in dispatch.get("allocations") or []:
            inventory_id = str(allocation.get("material_inventory_id") or "")
            if not inventory_id:
                continue
            allocation_map[inventory_id] = allocation_map.get(inventory_id, 0.0) + float(allocation.get("quantity") or 0.0)

    rows = []
    balances: Dict[str, float] = {}
    inventory_seq = 0
    dispatch_seq = 0
    sorted_rows = sorted(inventory_rows + dispatch_rows, key=lambda item: (item.get("date") or "", item.get("created_at") or ""))

    for row in sorted_rows:
        if row.get("material_name") is None:
            continue

        material = str(row.get("material_name") or "").strip()
        if not material:
            continue

        if "supplier" in row:
            inventory_seq += 1
            transaction_type = "Purchase"
            reference_no = f"MI-{inventory_seq:04d}"
            party = row.get("supplier") or ""
            qty_in = float(row.get("quantity") or 0.0)
            qty_out = 0.0
            unit = row.get("unit") or "pcs"
            rate = float(row.get("rate") or 0.0)
            current_qty = float(row.get("quantity") or 0.0)
            allocated_qty = allocation_map.get(str(row.get("id")), 0.0)
            qty_in = current_qty + allocated_qty
            amount = round((current_qty + allocated_qty) * rate, 2)
            balances[material] = balances.get(material, 0.0) + qty_in
            payment_source = payable_lookup.get(str(row.get("id")))
            payment_status = _payment_status_for_source(amount, float(payment_source.get("paid_amount") or 0.0) if payment_source else 0.0, "payables")
            entry = {
                "date": row.get("date"),
                "transaction_type": transaction_type,
                "reference_no": reference_no,
                "reference_id": row.get("id"),
                "source_type": "material_inventory",
                "party": party,
                "material": material,
                "qty_in": round(qty_in, 3),
                "qty_out": round(qty_out, 3),
                "balance": round(balances[material], 3),
                "unit": unit,
                "rate": round(rate, 2),
                "amount": round(amount, 2),
                "payment_status": payment_status,
            }
            rows.append(entry)
        else:
            dispatch_seq += 1
            transaction_type = "Dispatch"
            reference_no = f"MD-{dispatch_seq:04d}"
            party = ""
            vendor_id = row.get("vendor_id")
            if vendor_id:
                party = vendor_lookup.get(vendor_id, {}).get("name") or row.get("vendor") or row.get("vendor_name") or ""
            qty_in = 0.0
            qty_out = float(row.get("quantity") or 0.0)
            unit = row.get("unit") or "pcs"
            rate = float(row.get("rate") or 0.0)
            amount = float(row.get("amount") or 0.0)
            balances[material] = balances.get(material, 0.0) - qty_out
            payment_source = receivable_lookup.get(str(row.get("id")))
            payment_status = _payment_status_for_source(amount, float(payment_source.get("received_amount") or 0.0) if payment_source else 0.0, "receivables")
            entry = {
                "date": row.get("date"),
                "transaction_type": transaction_type,
                "reference_no": reference_no,
                "reference_id": row.get("id"),
                "source_type": "material_dispatch",
                "party": party,
                "material": material,
                "qty_in": round(qty_in, 3),
                "qty_out": round(qty_out, 3),
                "balance": round(balances[material], 3),
                "unit": unit,
                "rate": round(rate, 2),
                "amount": round(amount, 2),
                "payment_status": payment_status,
            }
            rows.append(entry)

    total_purchased = round(sum(item["qty_in"] for item in rows if item["transaction_type"] == "Purchase"), 3)
    total_dispatched = round(sum(item["qty_out"] for item in rows if item["transaction_type"] == "Dispatch"), 3)
    current_stock = round(sum(balances.values()), 3)
    current_stock_value = round(sum(item["amount"] for item in rows if item["transaction_type"] == "Purchase"), 2)
    average_purchase_rate = round(sum(item["rate"] * item["qty_in"] for item in rows if item["transaction_type"] == "Purchase") / total_purchased, 2) if total_purchased else 0.0

    return {
        "summary": {
            "current_stock": current_stock,
            "total_purchased": total_purchased,
            "total_dispatched": total_dispatched,
            "current_stock_value": current_stock_value,
            "average_purchase_rate": average_purchase_rate,
        },
        "rows": rows,
    }


def build_manufacturing_ledger(dispatches: List[Dict[str, Any]], returns: List[Dict[str, Any]], payments: List[Dict[str, Any]]) -> Dict[str, Any]:
    dispatch_lookup = {dispatch.get("id"): dispatch for dispatch in dispatches if dispatch.get("id")}

    groups = []
    for dispatch in dispatches:
        dispatch_id = dispatch.get("id")
        related_returns = [row for row in returns if (row.get("dispatch_id") or row.get("order_id")) == dispatch_id]
        expected_pieces = _resolve_expected_pieces(dispatch, related_returns)
        pieces_received_total = sum(_coerce_number(row.get("pieces_received"), 0) for row in related_returns)
        pieces_pending = max(int(expected_pieces) - pieces_received_total, 0) if expected_pieces else 0
        rows = []
        for row in related_returns:
            party = row.get("vendor_name") or dispatch.get("vendor_name") or ""
            reference_no = row.get("challan_no") or dispatch.get("challan_no") or ""
            total_job_work = _coerce_number(row.get("job_work_rate_per_piece"), 0.0) * _coerce_number(row.get("pieces_received"), 0)
            payment = next((item for item in payments if str(item.get("reference_no") or "") == str(reference_no)), None)
            paid_amount = _coerce_number(payment.get("amount"), 0.0) if payment else 0.0
            rows.append({
                "id": row.get("id"),
                "date": row.get("date"),
                "challan_no": reference_no,
                "lot_no": row.get("lot_no") or "",
                "article_barcode": row.get("article_barcode") or "",
                "pieces_received": int(_coerce_number(row.get("pieces_received"), 0)),
                "pieces_defected": int(_coerce_number(row.get("pieces_defected"), 0)),
                "kg_used": _coerce_number(row.get("kg_used"), 0.0),
                "fabric_returned_kg": _coerce_number(row.get("fabric_returned_kg"), 0.0),
                "cutting_waste_kg": _coerce_number(row.get("cutting_waste_kg"), 0.0),
                "job_work_rate_per_piece": _coerce_number(row.get("job_work_rate_per_piece"), 0.0),
                "job_work_amount": round(total_job_work, 2),
                "payment_status": _payment_status(total_job_work, paid_amount),
                "payment_reference": payment.get("reference_no") if payment else "",
                "payment_amount": round(paid_amount, 2),
                "notes": row.get("notes") or "",
                "party": party,
            })

        groups.append({
            "id": dispatch_id,
            "dispatch_no": str(dispatch.get("dispatch_no") or dispatch_id).strip() or dispatch_id,
            "date": dispatch.get("date"),
            "vendor_name": dispatch.get("vendor_name") or "",
            "challan_no": dispatch.get("challan_no") or "",
            "kg_dispatched": _coerce_number(dispatch.get("kg_dispatched"), 0.0),
            "expected_pieces": float(expected_pieces),
            "avg_fabric_per_piece": _coerce_number(dispatch.get("avg_fabric_per_piece"), 0.0),
            "pieces_received_total": pieces_received_total,
            "pieces_pending": pieces_pending,
            "rows": rows,
        })

    total_received_pieces = sum(group["pieces_received_total"] for group in groups)
    total_dispatched_kg = round(sum(group["kg_dispatched"] for group in groups), 3)
    avg_fabric_per_piece = round(total_dispatched_kg / total_received_pieces, 3) if total_received_pieces else 0.0
    summary = {
        "total_dispatched_kg": total_dispatched_kg,
        "total_pieces_received": total_received_pieces,
        "total_pieces_pending": sum(group["pieces_pending"] for group in groups),
        "total_defected_pieces": sum(row["pieces_defected"] for group in groups for row in group["rows"]),
        "avg_fabric_per_piece": avg_fabric_per_piece,
    }

    return {
        "summary": summary,
        "groups": groups,
    }


def build_vendor_job_work_ledger(
    dispatches: List[Dict[str, Any]],
    returns: List[Dict[str, Any]],
    links: List[Dict[str, Any]],
    lots: List[Dict[str, Any]] | None = None,
    product_types: List[Dict[str, Any]] | None = None,
) -> Dict[str, Any]:
    lot_lookup = {lot.get("id"): lot for lot in (lots or []) if lot.get("id")}
    product_lookup = {product.get("id"): product for product in (product_types or []) if product.get("id")}
    link_map: Dict[str, List[Dict[str, Any]]] = {}
    for link in links:
        dispatch_id = str(link.get("dispatch_id") or "").strip()
        challan_id = str(link.get("challan_id") or "").strip()
        if not dispatch_id or not challan_id:
            continue
        link_map.setdefault(dispatch_id, []).append({"challan_id": challan_id})

    return_lookup = {str(row.get("id") or ""): row for row in returns if row.get("id")}
    return_by_challan_no = {
        str(row.get("challan_no") or "").strip().lower(): row
        for row in returns
        if str(row.get("challan_no") or "").strip()
    }
    groups = []
    summary_receipts = []
    seen_summary_receipts = set()
    for dispatch in dispatches:
        dispatch_id = str(dispatch.get("id") or "").strip()
        linked_challans = link_map.get(dispatch_id, [])
        if not linked_challans:
            linked_challans = [{"challan_id": str(dispatch.get("linked_challan_id") or "").strip()}] if str(dispatch.get("linked_challan_id") or "").strip() else []

        related_receipts = []
        for link in linked_challans:
            challan_id = str(link.get("challan_id") or "").strip()
            if not challan_id:
                continue
            receipt = return_lookup.get(challan_id) or return_by_challan_no.get(challan_id.lower())
            if receipt:
                receipt_key = str(receipt.get("id") or receipt.get("challan_no") or challan_id)
                if receipt_key not in seen_summary_receipts:
                    seen_summary_receipts.add(receipt_key)
                    summary_receipts.append(receipt)
                related_receipts.append({
                    "id": receipt.get("id"),
                    "challan_no": receipt.get("challan_no") or "",
                    "date": receipt.get("date"),
                    "article_barcode": receipt.get("article_barcode") or "",
                    "lot_no": receipt.get("lot_no") or "",
                    "pieces_received": int(_coerce_number(receipt.get("pieces_received"), 0)),
                    "fabric_consumed_kg": round(_coerce_number(receipt.get("fabric_consumed_kg"), 0.0), 3),
                    "pieces_left": 0,
                    "pieces_defected": int(_coerce_number(receipt.get("pieces_defected"), 0)),
                    "expected_pieces": round(_extract_return_expected_pieces(receipt), 3),
                    "notes": receipt.get("notes") or "",
                })

        if not related_receipts:
            related_receipts = [
                {
                    "id": row.get("id"),
                    "challan_no": row.get("challan_no") or "",
                    "date": row.get("date"),
                    "article_barcode": row.get("article_barcode") or "",
                    "lot_no": row.get("lot_no") or "",
                    "pieces_received": int(_coerce_number(row.get("pieces_received"), 0)),
                    "fabric_consumed_kg": round(_coerce_number(row.get("fabric_consumed_kg"), 0.0), 3),
                    "pieces_left": 0,
                    "pieces_defected": int(_coerce_number(row.get("pieces_defected"), 0)),
                    "expected_pieces": round(_extract_return_expected_pieces(row), 3),
                    "notes": row.get("notes") or "",
                }
                for row in returns
                if (str(row.get("dispatch_id") or "") == dispatch_id) or (str(row.get("order_id") or "") == dispatch_id)
            ]

        lot = lot_lookup.get(dispatch.get("fabric_lot_id")) or {}
        product = product_lookup.get(dispatch.get("product_type_id")) or {}
        expected_pieces = _resolve_expected_pieces(dispatch, related_receipts)

        related_receipts = sorted(
            related_receipts,
            key=lambda item: (
                str(item.get("date") or ""),
                str(item.get("id") or ""),
            ),
        )
        running_received = 0
        for receipt in related_receipts:
            receipt_expected_pieces = _coerce_number(receipt.get("expected_pieces"), 0.0)
            effective_expected_pieces = receipt_expected_pieces if receipt_expected_pieces > 0 else expected_pieces
            running_received += int(_coerce_number(receipt.get("pieces_received"), 0))
            if effective_expected_pieces > 0:
                receipt["pieces_left"] = max(effective_expected_pieces - running_received, 0)
            else:
                receipt["pieces_left"] = 0

        total_received = sum(item.get("pieces_received", 0) for item in related_receipts)
        total_pending = max(expected_pieces - total_received, 0) if expected_pieces > 0 else 0

        groups.append({
            "id": dispatch_id,
            "dispatch_no": str(dispatch.get("dispatch_no") or dispatch_id).strip() or dispatch_id,
            "date": dispatch.get("date"),
            "supplier_name": lot.get("supplier") or "",
            "brand_name": dispatch.get("brand_name") or dispatch.get("brandName") or "",
            "fabric": lot.get("fabric_type") or "",
            "quantity": round(_coerce_number(dispatch.get("kg_dispatched"), 0.0), 3),
            "unit": "kg",
            "rolls": 1,
            "product_type": dispatch.get("product_type_name") or dispatch.get("product_type") or product.get("name") or "",
            "expected_pieces": expected_pieces,
            "related_receipts": related_receipts,
            "total_received": total_received,
            "total_pending": total_pending,
            "total_defective": sum(item.get("pieces_defected", 0) for item in related_receipts),
        })

    total_received_pieces = sum(int(_coerce_number(item.get("pieces_received"), 0)) for item in summary_receipts)
    total_defective_pieces = sum(int(_coerce_number(item.get("pieces_defected"), 0)) for item in summary_receipts)
    total_expected_pieces = int(sum(_coerce_number(group.get("expected_pieces"), 0) for group in groups))
    summary = {
        "vendor": "",
        "total_dispatches": len(groups),
        "total_fabric_dispatched": round(sum(group["quantity"] for group in groups), 3),
        "total_pieces_received": total_received_pieces,
        "total_pieces_pending": max(total_expected_pieces - total_received_pieces, 0),
        "total_defective_pieces": total_defective_pieces,
    }
    return {"summary": summary, "groups": groups}
