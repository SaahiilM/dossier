import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "dossier_deploy", Path(__file__).with_name("deploy-linux-main.py")
)
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentDecisionTests(unittest.TestCase):
    def test_unchanged_main_is_skipped(self):
        self.assertEqual(deploy.deployment_decision("a" * 40, "a" * 40, "", False), "unchanged")

    def test_failed_commit_is_not_retried_until_forced_or_new_commit(self):
        sha = "b" * 40
        self.assertEqual(deploy.deployment_decision(sha, "a" * 40, sha, False), "failed-before")
        self.assertEqual(deploy.deployment_decision(sha, "a" * 40, sha, True), "deploy")
        self.assertEqual(deploy.deployment_decision("c" * 40, "a" * 40, sha, False), "deploy")

    def test_failure_state_is_persisted_without_exposing_secrets(self):
        with tempfile.TemporaryDirectory() as temporary:
            original = deploy.STATE_FILE
            original_dir = deploy.STATE_DIR
            try:
                deploy.STATE_DIR = Path(temporary)
                deploy.STATE_FILE = deploy.STATE_DIR / "deploy.json"
                state = {"current_sha": "a" * 40}
                deploy.record_failure(state, "b" * 40, "candidate-smoke-health")
                self.assertEqual(deploy.get_state()["last_failed_sha"], "b" * 40)
                self.assertEqual(deploy.get_state()["last_failure"], "candidate-smoke-health")
                self.assertEqual(os.stat(deploy.STATE_FILE).st_mode & 0o777, 0o600)
            finally:
                deploy.STATE_FILE = original
                deploy.STATE_DIR = original_dir

    def test_deployment_lock_is_exclusive(self):
        with tempfile.TemporaryDirectory() as temporary:
            lock_path = Path(temporary) / "deploy.lock"
            first = deploy.acquire_lock(lock_path)
            try:
                self.assertIsNotNone(first)
                self.assertIsNone(deploy.acquire_lock(lock_path))
            finally:
                first.close()


if __name__ == "__main__":
    unittest.main()
