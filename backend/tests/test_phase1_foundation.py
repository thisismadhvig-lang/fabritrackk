from models import (
    CompanyORM,
    DocumentApprovalORM,
    DocumentAttachmentORM,
    DocumentAuditLogORM,
    DocumentLineORM,
    DocumentORM,
    DocumentSequenceORM,
    DocumentTypeORM,
    ItemCatalogORM,
    PartyORM,
    UnitORM,
    UserORM,
    WarehouseORM,
    build_document_number,
    DOCUMENT_STATES,
)


def test_core_phase1_models_exist_with_expected_tables():
    assert CompanyORM.__tablename__ == "companies"
    assert UserORM.__tablename__ == "users"
    assert PartyORM.__tablename__ == "parties"
    assert WarehouseORM.__tablename__ == "warehouses"
    assert UnitORM.__tablename__ == "units"
    assert ItemCatalogORM.__tablename__ == "item_catalog"
    assert DocumentTypeORM.__tablename__ == "document_types"
    assert DocumentSequenceORM.__tablename__ == "document_sequences"
    assert DocumentORM.__tablename__ == "documents"
    assert DocumentLineORM.__tablename__ == "document_lines"
    assert DocumentAttachmentORM.__tablename__ == "document_attachments"
    assert DocumentApprovalORM.__tablename__ == "document_approvals"
    assert DocumentAuditLogORM.__tablename__ == "document_audit_logs"


def test_document_states_and_numbering_are_available():
    assert DOCUMENT_STATES[0] == "draft"
    assert DOCUMENT_STATES[-1] == "cancelled"

    sequence = DocumentSequenceORM(prefix="FR", year=2026, last_number=0)
    assert build_document_number(sequence, year=2026, sequence_number=1) == "FR-2026-0001"
    assert build_document_number(sequence, year=2026, sequence_number=12) == "FR-2026-0012"
