import asyncio

import server


def test_startup_event_runs_schema_and_seed_helpers(monkeypatch):
    calls = []

    def fake_ensure_schema():
        calls.append("schema")

    def fake_ensure_customization_column():
        calls.append("customization")

    async def fake_seed_admin():
        calls.append("seed")

    monkeypatch.setattr(server, "ensure_schema", fake_ensure_schema)
    monkeypatch.setattr(server, "_ensure_customization_column", fake_ensure_customization_column)
    monkeypatch.setattr(server, "seed_admin", fake_seed_admin)

    asyncio.run(server.startup_event())

    assert calls == ["schema", "customization", "seed"]
