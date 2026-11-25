from typer.testing import CliRunner
from src.cli import app

runner = CliRunner()


def test_cli_status():
    result = runner.invoke(app, ["status"])
    assert result.exit_code == 0
    assert "operational" in result.stdout.lower()


def test_cli_help():
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "run" in result.stdout
    assert "inventory" in result.stdout
    assert "report" in result.stdout
    assert "apply" in result.stdout


def test_serve_only_auto_reloads_when_asked(monkeypatch):
    import src.cli as cli

    seen = []
    monkeypatch.setattr(cli.uvicorn, "run", lambda *args, **kwargs: seen.append(kwargs["reload"]))
    for args in (["serve"], ["serve", "--reload"], ["serve", "--no-reload"]):
        assert runner.invoke(app, args).exit_code == 0
    assert seen == [False, True, False]
