import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
class ReleaseBoundaryTests(unittest.TestCase):
    def test_bnb_changes_trigger_checks_before_deploy(self):
        workflow = (ROOT / '.github/workflows/deploy.yml').read_text()
        for path in ['bnb-market/**', 'frontend/**', 'backend/**']:
            self.assertIn(path, workflow)
        self.assertIn('needs: verify', workflow)
        self.assertIn('test:auth', workflow)
        self.assertIn('test:lp-storage', workflow)
        self.assertIn('test:agon', workflow)
        self.assertIn('VPS_HOST_FINGERPRINT', workflow)
        self.assertNotIn('uses: actions/checkout@v', workflow)
        self.assertNotIn('uses: appleboy/ssh-action@v', workflow)
    def test_release_preserves_shared_state(self):
        script = (ROOT / 'deploy/release.sh').read_text()
        commands = '\n'.join(line for line in script.splitlines() if not line.startswith('#'))
        for forbidden in ['git reset', 'compose down', '--remove-orphans', 'image prune', '--build']:
            self.assertNotIn(forbidden, commands)
        self.assertIn('trap rollback ERR', script)
        self.assertIn('pg_dump', script)
        self.assertIn('--wait', script)
    def test_bnb_environment_is_separate_and_database_is_not_exposed(self):
        compose = (ROOT / 'deploy/release.compose.yml').read_text()
        bnb = compose.split('  bnb-api:', 1)[1]
        self.assertIn('deploy/bnb.env', bnb)
        self.assertNotIn('deploy/.env', bnb)
        self.assertNotIn('ports:', compose)
        self.assertIn('external: true', compose)
        self.assertIn('name: deploy_default', compose)
    def test_caddy_keeps_other_products(self):
        caddy = (ROOT / 'deploy/caddy/Caddyfile').read_text()
        for host in ['api.agon.surf', 'api.arcrun.xyz', 'agentsqa.xyz', 'api.avow.site', 'api.sface.site']:
            self.assertIn(host + ' {', caddy)
        self.assertIn('handle /api/bnb/*', caddy)

if __name__ == '__main__': unittest.main()
