"""Local launcher lifecycle checks; no SSH, credentials or GPU requests."""
import contextlib
import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("vision_dev", Path(__file__).parents[1] / "scripts/vision-dev.py")
dev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dev)


class LauncherTests(unittest.TestCase):
    def test_missing_ssh_alias_fails_before_any_readiness_request(self):
        tunnel = Mock()
        tunnel.poll.return_value = 255
        with patch.object(dev, "build_opener") as factory:
            with self.assertRaisesRegex(RuntimeError, "SSH联调未启动"):
                dev.wait_ready(tunnel)
        factory.return_value.open.assert_not_called()

    def test_start_message_is_absent_after_child_failure_and_resources_close(self):
        tunnel = Mock()
        tunnel.poll.return_value = 255
        server = Mock()
        server.__enter__ = Mock(return_value=server)
        server.__exit__ = Mock(return_value=False)
        out, err = io.StringIO(), io.StringIO()
        with patch.object(dev, "HTTPServer", return_value=server), patch.object(dev.subprocess, "Popen", return_value=tunnel), patch.object(dev.subprocess, "run"), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            self.assertEqual(dev.main(), 1)
        self.assertNotIn("已启动", out.getvalue())
        self.assertIn("SSH联调未启动", err.getvalue())
        tunnel.stdin.close.assert_called_once()
        tunnel.wait.assert_called_once()
        server.__exit__.assert_called_once()

    def test_http_success_requires_model_ready_and_live_ssh_child(self):
        tunnel = Mock()
        tunnel.poll.return_value = None
        response = io.BytesIO(b'{"status":"ready"}')
        with patch.object(dev, "build_opener") as factory:
            factory.return_value.open.return_value = response
            dev.wait_ready(tunnel)
        self.assertGreaterEqual(tunnel.poll.call_count, 2)

    def test_a_running_tunnel_with_an_unready_model_times_out(self):
        tunnel = Mock()
        tunnel.poll.return_value = None
        with patch.object(dev, "build_opener") as factory, patch.object(dev.time, "monotonic", side_effect=[0, 0, 20]), patch.object(dev.time, "sleep"):
            factory.return_value.open.return_value = io.BytesIO(b'{"status":"loading"}')
            with self.assertRaisesRegex(RuntimeError, "尚未就绪"):
                dev.wait_ready(tunnel, timeout=15)


if __name__ == "__main__":
    unittest.main()
