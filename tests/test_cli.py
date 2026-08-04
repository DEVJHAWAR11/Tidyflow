from typer.testing import CliRunner
from src.cli import app

runner = CliRunner()

def test_config_set_llm():
    result = runner.invoke(app, ["config-set-llm", "dummy", "key"])
    assert result.exit_code == 0
    assert "Successfully configured dummy" in result.stdout
