from server import _normalize_postgres_url


def test_normalize_postgres_url_handles_sqlalchemy_and_postgres_prefixes():
    assert _normalize_postgres_url("postgresql+psycopg2://user:pass@localhost:5432/fabritrack") == (
        "postgresql://user:pass@localhost:5432/fabritrack"
    )
    assert _normalize_postgres_url("postgres://user:pass@localhost:5432/fabritrack") == (
        "postgresql://user:pass@localhost:5432/fabritrack"
    )
    assert _normalize_postgres_url("postgresql://user:pass@localhost:5432/fabritrack") == (
        "postgresql://user:pass@localhost:5432/fabritrack"
    )
