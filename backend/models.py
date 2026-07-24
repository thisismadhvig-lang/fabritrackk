from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


DOCUMENT_STATES = ["draft", "confirmed", "completed", "cancelled"]


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def uid() -> str:
    return str(uuid4())


class AuditColumnsMixin:
    created_at = Column(DateTime(timezone=True), default=now_utc, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=now_utc, onupdate=now_utc, nullable=False)
    deleted_at = Column(DateTime(timezone=True), default=None)
    is_deleted = Column(Boolean, default=False, nullable=False)


class CompanyORM(Base, AuditColumnsMixin):
    __tablename__ = "companies"

    id = Column(String, primary_key=True, index=True, default=uid)
    name = Column(String, nullable=False, index=True)
    code = Column(String, nullable=False, unique=True, index=True)
    address = Column(Text, default="")
    contact_email = Column(String, default="")
    contact_phone = Column(String, default="")
    is_active = Column(Boolean, default=True, nullable=False)

    users = relationship("UserORM", back_populates="company")
    parties = relationship("PartyORM", back_populates="company")
    warehouses = relationship("WarehouseORM", back_populates="company")
    units = relationship("UnitORM", back_populates="company")
    items = relationship("ItemCatalogORM", back_populates="company")
    document_types = relationship("DocumentTypeORM", back_populates="company")
    document_sequences = relationship("DocumentSequenceORM", back_populates="company")
    documents = relationship("DocumentORM", back_populates="company")
    document_lines = relationship("DocumentLineORM", back_populates="company")
    attachments = relationship("DocumentAttachmentORM", back_populates="company")
    approvals = relationship("DocumentApprovalORM", back_populates="company")
    audit_logs = relationship("DocumentAuditLogORM", back_populates="company")


class UserORM(Base, AuditColumnsMixin):
    __tablename__ = "users"

    id = Column(String, primary_key=True, index=True, default=uid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    username = Column(String, nullable=False, unique=True, index=True)
    email = Column(String, default="")
    password_hash = Column(String, nullable=False)
    display_name = Column(String, default="")
    role = Column(String, default="admin")
    is_active = Column(Boolean, default=True, nullable=False)

    company = relationship("CompanyORM", back_populates="users")
    documents = relationship("DocumentORM", back_populates="created_by_user", foreign_keys="DocumentORM.created_by_id")
    updated_documents = relationship("DocumentORM", back_populates="updated_by_user", foreign_keys="DocumentORM.updated_by_id")
    approvals = relationship("DocumentApprovalORM", back_populates="user")
    audit_logs = relationship("DocumentAuditLogORM", back_populates="user")


class PartyORM(Base, AuditColumnsMixin):
    __tablename__ = "parties"

    id = Column(String, primary_key=True, index=True, default=uid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    party_type = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False, index=True)
    code = Column(String, default="")
    contact_name = Column(String, default="")
    email = Column(String, default="")
    phone = Column(String, default="")
    address = Column(Text, default="")
    tax_number = Column(String, default="")
    is_active = Column(Boolean, default=True, nullable=False)

    company = relationship("CompanyORM", back_populates="parties")


class WarehouseORM(Base, AuditColumnsMixin):
    __tablename__ = "warehouses"

    id = Column(String, primary_key=True, index=True, default=uid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    name = Column(String, nullable=False, index=True)
    code = Column(String, nullable=False, unique=True, index=True)
    location = Column(String, default="")
    warehouse_type = Column(String, default="general")
    is_active = Column(Boolean, default=True, nullable=False)

    company = relationship("CompanyORM", back_populates="warehouses")


class UnitORM(Base, AuditColumnsMixin):
    __tablename__ = "units"

    id = Column(String, primary_key=True, index=True, default=uid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    name = Column(String, nullable=False, index=True)
    symbol = Column(String, nullable=False, unique=True, index=True)
    is_active = Column(Boolean, default=True, nullable=False)

    company = relationship("CompanyORM", back_populates="units")


class ItemCatalogORM(Base, AuditColumnsMixin):
    __tablename__ = "item_catalog"

    id = Column(String, primary_key=True, index=True, default=uid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    code = Column(String, nullable=False, unique=True, index=True)
    name = Column(String, nullable=False, index=True)
    item_type = Column(String, nullable=False, index=True)
    default_unit_id = Column(String, ForeignKey("units.id"), nullable=True, index=True)
    description = Column(Text, default="")
    is_active = Column(Boolean, default=True, nullable=False)

    company = relationship("CompanyORM", back_populates="items")


class DocumentTypeORM(Base, AuditColumnsMixin):
    __tablename__ = "document_types"

    id = Column(String, primary_key=True, index=True, default=uid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    code = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False, index=True)
    document_kind = Column(String, default="generic")
    is_active = Column(Boolean, default=True, nullable=False)

    company = relationship("CompanyORM", back_populates="document_types")
    sequences = relationship("DocumentSequenceORM", back_populates="document_type")
    documents = relationship("DocumentORM", back_populates="document_type")

    __table_args__ = (UniqueConstraint("company_id", "code", name="uq_document_type_code"),)


class DocumentSequenceORM(Base, AuditColumnsMixin):
    __tablename__ = "document_sequences"

    id = Column(String, primary_key=True, index=True, default=uid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    document_type_id = Column(String, ForeignKey("document_types.id"), nullable=False, index=True)
    prefix = Column(String, nullable=False, index=True)
    year = Column(Integer, nullable=False, index=True)
    last_number = Column(Integer, nullable=False, default=0)

    company = relationship("CompanyORM", back_populates="document_sequences")
    document_type = relationship("DocumentTypeORM", back_populates="sequences")

    __table_args__ = (UniqueConstraint("company_id", "document_type_id", "year", name="uq_document_sequence"),)


class DocumentORM(Base, AuditColumnsMixin):
    __tablename__ = "documents"

    id = Column(String, primary_key=True, index=True, default=uid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    document_type_id = Column(String, ForeignKey("document_types.id"), nullable=False, index=True)
    document_number = Column(String, nullable=False, unique=True, index=True)
    document_state = Column(String, nullable=False, default="draft", index=True)
    document_date = Column(DateTime(timezone=True), default=now_utc, nullable=False)
    created_by_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    updated_by_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    reference_document_id = Column(String, ForeignKey("documents.id"), nullable=True, index=True)
    remarks = Column(Text, default="")
    is_active = Column(Boolean, default=True, nullable=False)
    version = Column(Integer, default=1, nullable=False)

    company = relationship("CompanyORM", back_populates="documents")
    document_type = relationship("DocumentTypeORM", back_populates="documents")
    created_by_user = relationship("UserORM", back_populates="documents", foreign_keys=[created_by_id])
    updated_by_user = relationship("UserORM", back_populates="updated_documents", foreign_keys=[updated_by_id])
    reference_document = relationship("DocumentORM", remote_side=[id], foreign_keys=[reference_document_id])
    lines = relationship("DocumentLineORM", back_populates="document")
    attachments = relationship("DocumentAttachmentORM", back_populates="document")
    approvals = relationship("DocumentApprovalORM", back_populates="document")
    audit_logs = relationship("DocumentAuditLogORM", back_populates="document")


class DocumentLineORM(Base, AuditColumnsMixin):
    __tablename__ = "document_lines"

    id = Column(String, primary_key=True, index=True, default=uid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    document_id = Column(String, ForeignKey("documents.id"), nullable=False, index=True)
    line_number = Column(Integer, nullable=False, default=1)
    item_id = Column(String, ForeignKey("item_catalog.id"), nullable=False, index=True)
    warehouse_id = Column(String, ForeignKey("warehouses.id"), nullable=True, index=True)
    quantity = Column(Float, nullable=False, default=0.0)
    unit_id = Column(String, ForeignKey("units.id"), nullable=True, index=True)
    unit_price = Column(Float, default=0.0)
    remarks = Column(Text, default="")
    line_type = Column(String, default="standard")

    company = relationship("CompanyORM", back_populates="document_lines")
    document = relationship("DocumentORM", back_populates="lines")


class DocumentAttachmentORM(Base, AuditColumnsMixin):
    __tablename__ = "document_attachments"

    id = Column(String, primary_key=True, index=True, default=uid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    document_id = Column(String, ForeignKey("documents.id"), nullable=False, index=True)
    file_name = Column(String, nullable=False, index=True)
    file_type = Column(String, default="")
    storage_path = Column(String, nullable=False)
    uploaded_by_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)

    company = relationship("CompanyORM", back_populates="attachments")
    document = relationship("DocumentORM", back_populates="attachments")


class DocumentApprovalORM(Base, AuditColumnsMixin):
    __tablename__ = "document_approvals"

    id = Column(String, primary_key=True, index=True, default=uid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    document_id = Column(String, ForeignKey("documents.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    decision = Column(String, nullable=False, index=True)
    comment = Column(Text, default="")
    approved_at = Column(DateTime(timezone=True), default=now_utc)

    company = relationship("CompanyORM", back_populates="approvals")
    document = relationship("DocumentORM", back_populates="approvals")
    user = relationship("UserORM", back_populates="approvals")


class DocumentAuditLogORM(Base, AuditColumnsMixin):
    __tablename__ = "document_audit_logs"

    id = Column(String, primary_key=True, index=True, default=uid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    document_id = Column(String, ForeignKey("documents.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    action = Column(String, nullable=False, index=True)
    details = Column(Text, default="")

    company = relationship("CompanyORM", back_populates="audit_logs")
    document = relationship("DocumentORM", back_populates="audit_logs")
    user = relationship("UserORM", back_populates="audit_logs")


class DocumentReferenceORM(Base, AuditColumnsMixin):
    __tablename__ = "document_references"

    id = Column(String, primary_key=True, index=True, default=uid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    source_document_id = Column(String, ForeignKey("documents.id"), nullable=False, index=True)
    target_document_id = Column(String, ForeignKey("documents.id"), nullable=False, index=True)
    relation_type = Column(String, nullable=False, default="linked")


class BuyerORM(Base, AuditColumnsMixin):
    __tablename__ = "buyers"

    id = Column(String, primary_key=True, index=True, default=uid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    name = Column(String, nullable=False, index=True)
    contact = Column(String, default="")
    country = Column(String, default="")
    type = Column(String, default="local")
    archived = Column(Boolean, default=False, nullable=False)


class ProductTypeORM(Base, AuditColumnsMixin):
    __tablename__ = "product_types"

    id = Column(String, primary_key=True, index=True, default=uid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    name = Column(String, nullable=False, index=True)
    avg_fabric_per_piece_kg = Column(Float, default=0.25, nullable=False)
    description = Column(Text, default="")
    archived = Column(Boolean, default=False, nullable=False)


class VendorORM(Base, AuditColumnsMixin):
    __tablename__ = "vendors"

    id = Column(String, primary_key=True, index=True, default=uid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    name = Column(String, nullable=False, index=True)
    type = Column(String, default="third_party")
    contact = Column(String, default="")
    location = Column(String, default="")
    archived = Column(Boolean, default=False, nullable=False)


class FabricLotORM(Base, AuditColumnsMixin):
    __tablename__ = "fabric_lots"

    id = Column(String, primary_key=True, index=True, default=uid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    fabric_type = Column(String, nullable=False, index=True)
    color = Column(String, default="")
    supplier = Column(String, default="")
    kg_received = Column(Float, nullable=False, default=0.0)
    cost_per_kg = Column(Float, default=0.0, nullable=False)
    date_received = Column(DateTime(timezone=True), default=now_utc, nullable=False)
    notes = Column(Text, default="")
    archived = Column(Boolean, default=False, nullable=False)


class FabricDispatchORM(Base, AuditColumnsMixin):
    __tablename__ = "fabric_dispatches"

    id = Column(String, primary_key=True, index=True, default=uid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    fabric_lot_id = Column(String, nullable=False, index=True)
    vendor_id = Column(String, nullable=False, index=True)
    order_id = Column(String, nullable=True, index=True)
    product_type_id = Column(String, nullable=True, index=True)
    kg_dispatched = Column(Float, nullable=False, default=0.0)
    date = Column(DateTime(timezone=True), default=now_utc, nullable=False)
    notes = Column(Text, default="")
    archived = Column(Boolean, default=False, nullable=False)


class OrderORM(Base, AuditColumnsMixin):
    __tablename__ = "orders"

    id = Column(String, primary_key=True, index=True, default=uid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    order_number = Column(String, nullable=False, index=True)
    buyer_id = Column(String, nullable=False, index=True)
    product_type_id = Column(String, nullable=False, index=True)
    quantity = Column(Integer, nullable=False, default=0)
    unit_price = Column(Float, default=0.0, nullable=False)
    stage = Column(String, default="order_received")
    order_date = Column(DateTime(timezone=True), default=now_utc, nullable=False)
    delivery_date = Column(DateTime(timezone=True), nullable=True)
    notes = Column(Text, default="")
    archived = Column(Boolean, default=False, nullable=False)


class ProductionReturnORM(Base, AuditColumnsMixin):
    __tablename__ = "production_returns"

    id = Column(String, primary_key=True, index=True, default=uid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    vendor_id = Column(String, nullable=False, index=True)
    order_id = Column(String, nullable=True, index=True)
    product_type_id = Column(String, nullable=False, index=True)
    pieces_received = Column(Integer, nullable=False, default=0)
    pieces_defected = Column(Integer, default=0, nullable=False)
    kg_used = Column(Float, default=0.0, nullable=False)
    fabric_returned_kg = Column(Float, default=0.0, nullable=False)
    cutting_waste_kg = Column(Float, default=0.0, nullable=False)
    job_work_rate_per_piece = Column(Float, default=0.0, nullable=False)
    date = Column(DateTime(timezone=True), default=now_utc, nullable=False)
    notes = Column(Text, default="")
    archived = Column(Boolean, default=False, nullable=False)


class AppSettingORM(Base, AuditColumnsMixin):
    __tablename__ = "app_settings"

    id = Column(String, primary_key=True, index=True, default=uid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    key = Column(String, nullable=False, unique=True, index=True)
    app_name = Column(String, default="LOOMLINE")
    tagline = Column(String, default="Manufacturing ERP")


def build_document_number(sequence: DocumentSequenceORM, *, year: int, sequence_number: int) -> str:
    return f"{sequence.prefix}-{year}-{sequence_number:04d}"


__all__ = [
    "Base",
    "AuditColumnsMixin",
    "CompanyORM",
    "UserORM",
    "PartyORM",
    "WarehouseORM",
    "UnitORM",
    "ItemCatalogORM",
    "DocumentTypeORM",
    "DocumentSequenceORM",
    "DocumentORM",
    "DocumentLineORM",
    "DocumentAttachmentORM",
    "DocumentApprovalORM",
    "DocumentAuditLogORM",
    "DocumentReferenceORM",
    "BuyerORM",
    "ProductTypeORM",
    "VendorORM",
    "FabricLotORM",
    "FabricDispatchORM",
    "OrderORM",
    "ProductionReturnORM",
    "AppSettingORM",
    "DOCUMENT_STATES",
    "build_document_number",
]
