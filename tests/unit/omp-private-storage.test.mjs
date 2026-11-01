import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { privateRoot, preparePrivateFile, readPrivateJson, writePrivateJson } from '../../integrations/omp/private-storage.js';

const WINDOWS = process.platform === 'win32';
const ERROR_CODE = 'ERR_OMP_PRIVATE_STORAGE';
const VALUE = { token: 'synthetic-private-token', port: 43123, enabled: true };

// ACL changes are confined to this test's disposable tree, never TEMP, home or the checkout.
const FIXTURE_ACL = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$trusted = @($current.Value, 'S-1-5-18', 'S-1-5-32-544')
if ($request.action -eq 'create') {
  $security = New-Object System.Security.AccessControl.DirectorySecurity
  $security.SetOwner($current)
  $security.SetAccessRuleProtection($true, $false)
  foreach ($sid in $trusted) {
    $identity = New-Object System.Security.Principal.SecurityIdentifier($sid)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')
    $security.AddAccessRule($rule)
  }
  [System.IO.Directory]::CreateDirectory($request.file, $security) | Out-Null
} elseif ($request.action -eq 'allow') {
  $directory = [System.IO.Directory]::Exists($request.file)
  if ($directory) { $before = [System.IO.Directory]::GetAccessControl($request.file) }
  else { $before = [System.IO.File]::GetAccessControl($request.file) }
  $owner = $before.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
  $protected = $before.AreAccessRulesProtected
  if ($directory) { $acl = [System.IO.Directory]::GetAccessControl($request.file, [System.Security.AccessControl.AccessControlSections]::Access) }
  else { $acl = [System.IO.File]::GetAccessControl($request.file, [System.Security.AccessControl.AccessControlSections]::Access) }
  $sid = 'S-1-1-0'
  if ($request.sid) { $sid = $request.sid }
  $principal = New-Object System.Security.Principal.SecurityIdentifier($sid)
  if ($request.inheritOnly) {
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($principal, $request.rights, 'ContainerInherit, ObjectInherit', 'InheritOnly', 'Allow')
  } else {
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($principal, $request.rights, 'None', 'None', 'Allow')
  }
  $acl.AddAccessRule($rule)
  if ($directory) {
    [System.IO.Directory]::SetAccessControl($request.file, $acl)
    $after = [System.IO.Directory]::GetAccessControl($request.file)
  } else {
    [System.IO.File]::SetAccessControl($request.file, $acl)
    $after = [System.IO.File]::GetAccessControl($request.file)
  }
  if ($after.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $owner -or $after.AreAccessRulesProtected -ne $protected) { throw 'Fixture changed owner or protection' }
  $installed = @($after.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | Where-Object {
    $_.IdentityReference.Value -eq $sid -and $_.AccessControlType -eq 'Allow' -and
    (([long]$_.FileSystemRights -band [long]$rule.FileSystemRights) -eq [long]$rule.FileSystemRights) -and
    $_.PropagationFlags -eq $rule.PropagationFlags
  })
  if ($installed.Count -eq 0) { throw 'Fixture access rule was not installed' }
} elseif ($request.action -eq 'assert') {
  if ($request.directory) { $acl = [System.IO.Directory]::GetAccessControl($request.file) } else { $acl = [System.IO.File]::GetAccessControl($request.file) }
  if ($request.directory -and -not $acl.AreAccessRulesProtected) { throw 'Directory DACL is not protected' }
  if ($trusted -notcontains $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value) { throw 'Unexpected owner' }
  $descriptor = New-Object System.Security.AccessControl.RawSecurityDescriptor($acl.GetSecurityDescriptorBinaryForm(), 0)
  if ($null -eq $descriptor.DiscretionaryAcl) { throw 'Null DACL' }
  foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq 'Allow' -and $trusted -notcontains $rule.IdentityReference.Value) { throw 'Unexpected access grant' }
  }
} else { throw 'Unexpected fixture action' }
`;

function fixtureAcl(action, file, options = {}) {
  execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', FIXTURE_ACL], {
      input: JSON.stringify({ action, file, ...options }), encoding: 'utf8', windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'], timeout: 15_000,
    });
}

function fixture(t) {
  const temporaryParent = fs.realpathSync(WINDOWS ? os.homedir() : os.tmpdir());
  let home;
  if (WINDOWS) {
    home = path.join(temporaryParent, `omp-private-storage-${randomUUID()}`);
    fixtureAcl('create', home);
  } else {
    home = fs.mkdtempSync(path.join(temporaryParent, 'omp-private-storage-'));
  }
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, '.omp'), { mode: 0o700 });
  const root = privateRoot(home);
  return { home, root, file: path.join(root, 'ingest.json') };
}

function rejectsStorage(operation) {
  assert.throws(operation, (error) => {
    assert.equal(error.code, ERROR_CODE);
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(error.message, /synthetic-private-token|[\\/]/);
    return true;
  });
}

function assertPrivate(file, directory = false) {
  const stat = fs.lstatSync(file);
  if (directory) assert.ok(stat.isDirectory());
  else { assert.ok(stat.isFile()); assert.equal(stat.nlink, 1); }
  if (WINDOWS) fixtureAcl('assert', file, { directory });
  else {
    assert.equal(stat.uid, process.getuid());
    assert.equal(stat.mode & 0o777, directory ? 0o700 : 0o600);
  }
}

function broaden(file, rights = 'Read') {
  if (WINDOWS) fixtureAcl('allow', file, { rights });
  else fs.chmodSync(file, fs.statSync(file).isDirectory() ? 0o755 : 0o644);
}

test('optional missing reads do not create the private directory or intermediate ancestors', (t) => {
  const { home, root, file } = fixture(t);
  assert.equal(preparePrivateFile(file), false);
  assert.equal(readPrivateJson(file), null);
  assert.equal(fs.existsSync(root), false);
  const missingAncestor = path.join(home, 'missing', 'private', 'observer.json');
  assert.equal(readPrivateJson(missingAncestor), null);
  assert.equal(fs.existsSync(path.join(home, 'missing')), false);
});

test('create, read and atomic replacement preserve private ACLs and leave no temporary files', (t) => {
  const { root, file } = fixture(t);
  assert.equal(preparePrivateFile(file, { createDirectory: true }), false);
  assertPrivate(root, true);
  assert.equal(writePrivateJson(file, VALUE), undefined);
  assert.equal(preparePrivateFile(file), true);
  assert.deepEqual(readPrivateJson(file), VALUE);
  assertPrivate(file);
  const replacement = { ...VALUE, token: 'synthetic-rotated-token' };
  writePrivateJson(file, replacement);
  assert.deepEqual(readPrivateJson(file), replacement);
  assertPrivate(root, true);
  assertPrivate(file);
  assert.deepEqual(fs.readdirSync(root), ['ingest.json']);
});

test('an open reader never exposes a partial replacement or leaves temporary credentials', (t) => {
  const { root, file } = fixture(t);
  writePrivateJson(file, VALUE);
  const descriptor = fs.openSync(file, 'r');
  const replacement = { ...VALUE, token: 'synthetic-rotated-token' };
  try {
    if (WINDOWS) {
      rejectsStorage(() => writePrivateJson(file, replacement));
      assert.deepEqual(readPrivateJson(file), VALUE);
    } else {
      writePrivateJson(file, replacement);
      assert.deepEqual(readPrivateJson(file), replacement);
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(descriptor, 'utf8')), VALUE);
    assert.deepEqual(fs.readdirSync(root), ['ingest.json']);
  } finally { fs.closeSync(descriptor); }
  writePrivateJson(file, replacement);
  assert.deepEqual(readPrivateJson(file), replacement);
  assertPrivate(file);
});

test('write creates exactly the leaf directory and refuses a missing parent', (t) => {
  const { home } = fixture(t);
  const file = path.join(home, 'absent-parent', 'private', 'observer.json');
  rejectsStorage(() => writePrivateJson(file, VALUE));
  assert.equal(fs.existsSync(path.join(home, 'absent-parent')), false);
});

test('insecure precreated private directories are rejected, never repaired', (t) => {
  const { root, file } = fixture(t);
  fs.mkdirSync(root, { mode: 0o700 });
  broaden(root);
  rejectsStorage(() => preparePrivateFile(file));
  rejectsStorage(() => readPrivateJson(file));
  rejectsStorage(() => writePrivateJson(file, VALUE));
  assert.equal(fs.existsSync(file), false);
  if (!WINDOWS) assert.equal(fs.statSync(root).mode & 0o777, 0o755);
});

test('a broad-ACL file moved into a private directory is rejected for reads and replacement', (t) => {
  const { home, root, file } = fixture(t);
  preparePrivateFile(file, { createDirectory: true });
  const imported = path.join(home, 'imported.json');
  fs.writeFileSync(imported, JSON.stringify(VALUE), { mode: 0o600 });
  broaden(imported);
  fs.renameSync(imported, file);
  rejectsStorage(() => preparePrivateFile(file));
  rejectsStorage(() => readPrivateJson(file));
  rejectsStorage(() => writePrivateJson(file, { replacement: true }));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), VALUE);
  assert.deepEqual(fs.readdirSync(root), ['ingest.json']);
  if (!WINDOWS) assert.equal(fs.statSync(file).mode & 0o777, 0o644);
});

test('hardlinked private files cannot be read or replaced', (t) => {
  const { home, file } = fixture(t);
  writePrivateJson(file, VALUE);
  const alias = path.join(home, 'alias.json');
  fs.linkSync(file, alias);
  assert.equal(fs.statSync(file).nlink, 2);
  rejectsStorage(() => preparePrivateFile(file));
  rejectsStorage(() => readPrivateJson(file));
  rejectsStorage(() => writePrivateJson(file, { replacement: true }));
  assert.deepEqual(JSON.parse(fs.readFileSync(alias, 'utf8')), VALUE);
});

test('directory symlinks and Windows junctions cannot hide private storage or missing files', (t) => {
  const { home, root, file } = fixture(t);
  const target = path.join(home, 'real-private');
  fs.mkdirSync(target, { mode: 0o700 });
  fs.symlinkSync(target, root, WINDOWS ? 'junction' : 'dir');
  rejectsStorage(() => preparePrivateFile(file));
  rejectsStorage(() => readPrivateJson(file));
  rejectsStorage(() => writePrivateJson(file, VALUE));
  assert.deepEqual(fs.readdirSync(target), []);
});

test('file symlinks are rejected rather than followed', (t) => {
  const { home, file } = fixture(t);
  preparePrivateFile(file, { createDirectory: true });
  const target = path.join(home, 'target.json');
  fs.writeFileSync(target, JSON.stringify(VALUE), { mode: 0o600 });
  try { fs.symlinkSync(target, file, 'file'); }
  catch (error) {
    if (WINDOWS && error.code === 'EPERM') { t.skip('File symlink creation requires Windows Developer Mode or privilege; junction coverage remains active.'); return; }
    throw error;
  }
  rejectsStorage(() => readPrivateJson(file));
  rejectsStorage(() => writePrivateJson(file, VALUE));
  assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), VALUE);
});

test('malformed JSON fails with a sanitized error and is not repaired', (t) => {
  const { file } = fixture(t);
  writePrivateJson(file, VALUE);
  const invalid = '{"token":"synthetic-private-token",';
  fs.writeFileSync(file, invalid);
  rejectsStorage(() => readPrivateJson(file));
  assert.equal(fs.readFileSync(file, 'utf8'), invalid);
  assertPrivate(file);
});

test('JSON null is malformed storage, not a missing credential file', (t) => {
  const { file } = fixture(t);
  writePrivateJson(file, VALUE);
  fs.writeFileSync(file, 'null\n');
  rejectsStorage(() => readPrivateJson(file));
  assert.equal(fs.readFileSync(file, 'utf8'), 'null\n');
});

test('read byte limits reject oversized JSON before parsing, including multibyte content', (t) => {
  const { file } = fixture(t);
  const value = { text: 'Tiếng Việt' };
  writePrivateJson(file, value);
  const size = fs.statSync(file).size;
  assert.deepEqual(readPrivateJson(file, { maxBytes: size }), value);
  rejectsStorage(() => readPrivateJson(file, { maxBytes: size - 1 }));
  for (const maxBytes of [0, -1, NaN, Infinity, 1.5, '4096']) {
    rejectsStorage(() => readPrivateJson(file, { maxBytes }));
  }
  writePrivateJson(file, { text: 'x'.repeat(64 * 1024) });
  rejectsStorage(() => readPrivateJson(file));
});

test('serialization errors cannot damage an existing file or leave temporary files', (t) => {
  const { root, file } = fixture(t);
  writePrivateJson(file, VALUE);
  const circular = {};
  circular.self = circular;
  for (const value of [undefined, circular, 1n]) rejectsStorage(() => writePrivateJson(file, value));
  assert.deepEqual(readPrivateJson(file), VALUE);
  assert.deepEqual(fs.readdirSync(root), ['ingest.json']);
});

test('untrusted writable ancestry is rejected even when the private leaf is absent', (t) => {
  const { home, root, file } = fixture(t);
  const ancestor = path.join(home, '.omp');
  if (WINDOWS) fixtureAcl('allow', ancestor, { rights: 'Delete' });
  else fs.chmodSync(ancestor, 0o777);
  rejectsStorage(() => readPrivateJson(file));
  rejectsStorage(() => writePrivateJson(file, VALUE));
  assert.equal(fs.existsSync(root), false);
});

test('Windows FILE_DELETE_CHILD on an ancestor is rejected independently of DELETE', { skip: !WINDOWS }, (t) => {
  const { home, root, file } = fixture(t);
  fixtureAcl('allow', path.join(home, '.omp'), { rights: 'DeleteSubdirectoriesAndFiles' });
  rejectsStorage(() => preparePrivateFile(file));
  rejectsStorage(() => writePrivateJson(file, VALUE));
  assert.equal(fs.existsSync(root), false);
});

for (const rights of ['ChangePermissions', 'TakeOwnership']) {
  test(`Windows untrusted ancestor ${rights} is rejected`, { skip: !WINDOWS }, (t) => {
    const { home, root, file } = fixture(t);
    fixtureAcl('allow', path.join(home, '.omp'), { rights });
    rejectsStorage(() => readPrivateJson(file));
    rejectsStorage(() => writePrivateJson(file, VALUE));
    assert.equal(fs.existsSync(root), false);
  });
}

test('existing non-file targets and non-directory ancestors fail closed, not as missing', (t) => {
  const { root, file } = fixture(t);
  preparePrivateFile(file, { createDirectory: true });
  fs.mkdirSync(file, { mode: 0o700 });
  rejectsStorage(() => readPrivateJson(file));
  rejectsStorage(() => writePrivateJson(file, VALUE));
  fs.rmdirSync(file);
  writePrivateJson(file, VALUE);
  rejectsStorage(() => readPrivateJson(path.join(file, 'private', 'observer.json')));
  assert.deepEqual(fs.readdirSync(root), ['ingest.json']);
});

test('Windows private directories reject even inherit-only untrusted grants', { skip: !WINDOWS }, (t) => {
  const { root, file } = fixture(t);
  preparePrivateFile(file, { createDirectory: true });
  fixtureAcl('allow', root, { rights: 'Read', inheritOnly: true });
  rejectsStorage(() => readPrivateJson(file));
  rejectsStorage(() => writePrivateJson(file, VALUE));
  assert.deepEqual(fs.readdirSync(root), []);
});

test('Windows private leaf removes inherited-only exposure from an otherwise trusted ancestor', { skip: !WINDOWS }, (t) => {
  const { home, root, file } = fixture(t);
  fixtureAcl('allow', path.join(home, '.omp'), { rights: 'Modify', inheritOnly: true });
  writePrivateJson(file, VALUE);
  assert.deepEqual(readPrivateJson(file), VALUE);
  assertPrivate(root, true);
  assertPrivate(file);
});

test('Windows TrustedInstaller grants are trusted only outside the private leaf', { skip: !WINDOWS }, (t) => {
  const { home, root, file } = fixture(t);
  const sid = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464';
  fixtureAcl('allow', path.join(home, '.omp'), { sid, rights: 'FullControl' });
  writePrivateJson(file, VALUE);
  assert.deepEqual(readPrivateJson(file), VALUE);
  fixtureAcl('allow', root, { sid, rights: 'Read' });
  rejectsStorage(() => readPrivateJson(file));
  rejectsStorage(() => writePrivateJson(file, VALUE));
});

test('absolute path and options validation return only fixed storage errors', (t) => {
  const { file } = fixture(t);
  const invalidPaths = ['', 'relative.json', null, undefined, 42, `${file}\0`, path.parse(file).root];
  if (WINDOWS) invalidPaths.push('C:relative.json', '\\\\server\\share\\secret.json', `${file}:stream`, `${file}.`);
  for (const invalid of invalidPaths) {
    rejectsStorage(() => preparePrivateFile(invalid));
    rejectsStorage(() => readPrivateJson(invalid));
    rejectsStorage(() => writePrivateJson(invalid, VALUE));
  }
  rejectsStorage(() => preparePrivateFile(file, null));
  rejectsStorage(() => preparePrivateFile(file, { createDirectory: 'yes' }));
  rejectsStorage(() => readPrivateJson(file, null));
});
