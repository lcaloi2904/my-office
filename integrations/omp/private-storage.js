import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ERROR_CODE = 'ERR_OMP_PRIVATE_STORAGE';
const WINDOWS = process.platform === 'win32';

function storageError() {
  return Object.assign(new Error('Private telemetry storage is unavailable or unsafe.'), { code: ERROR_CODE });
}

// This script never receives JSON contents or returns native exception messages.
// DirectorySecurity is supplied to CreateDirectory: there is no permissive-then-chmod window.
const WINDOWS_PREPARE = String.raw`
$ErrorActionPreference = 'Stop'
try {
  [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $privateSids = @($current.Value, 'S-1-5-18', 'S-1-5-32-544')
  $ownerSids = $privateSids + @('S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
  function Attributes($name) {
    try { return [System.IO.File]::GetAttributes($name) }
    catch [System.IO.FileNotFoundException] { return $null }
    catch [System.IO.DirectoryNotFoundException] { return $null }
  }
  function Check($name, $directory, $private) {
    $attributes = Attributes $name
    if ($null -eq $attributes) { return $false }
    if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'unsafe' }
    $isDirectory = ($attributes -band [System.IO.FileAttributes]::Directory) -ne 0
    if ($isDirectory -ne $directory) { throw 'unsafe' }
    if ($directory) { $acl = [System.IO.Directory]::GetAccessControl($name) }
    else { $acl = [System.IO.File]::GetAccessControl($name) }
    $owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
    if ($private) { $owners = $privateSids } else { $owners = $ownerSids }
    if ($owners -notcontains $owner) { throw 'unsafe' }
    if ($private -and $directory -and -not $acl.AreAccessRulesProtected) { throw 'unsafe' }
    if (-not $acl.AreAccessRulesCanonical) { throw 'unsafe' }
    $descriptor = New-Object System.Security.AccessControl.RawSecurityDescriptor($acl.GetSecurityDescriptorBinaryForm(), 0)
    if ($null -eq $descriptor.DiscretionaryAcl) { throw 'unsafe' }
    $rules = $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
    foreach ($rule in $rules) {
      if (-not $private -and (($rule.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0)) { continue }
      if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { continue }
      if ($owners -contains $rule.IdentityReference.Value) { continue }
      # DELETE, WRITE_DAC, WRITE_OWNER, GENERIC_ALL and FILE_DELETE_CHILD.
      $rights = [long]$rule.FileSystemRights
      if ($private -or (($rights -band 0x100D0040) -ne 0)) { throw 'unsafe' }
    }
    return $true
  }
  $parent = [System.IO.Path]::GetDirectoryName($request.file)
  $chain = New-Object 'System.Collections.Generic.List[string]'
  $cursor = $parent
  while ($null -ne $cursor) {
    $chain.Insert(0, $cursor)
    $next = [System.IO.Directory]::GetParent($cursor)
    if ($null -eq $next) { $cursor = $null } else { $cursor = $next.FullName }
  }
  $missing = $false
  for ($index = 0; $index -lt $chain.Count; $index++) {
    $leaf = $index -eq ($chain.Count - 1)
    $exists = Check $chain[$index] $true $leaf
    if (-not $exists) {
      if ($request.createDirectory -and $leaf) {
        $security = New-Object System.Security.AccessControl.DirectorySecurity
        $security.SetOwner($current)
        $security.SetAccessRuleProtection($true, $false)
        foreach ($sid in $privateSids) {
          $identity = New-Object System.Security.Principal.SecurityIdentifier($sid)
          $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')
          $security.AddAccessRule($rule)
        }
        [System.IO.Directory]::CreateDirectory($chain[$index], $security) | Out-Null
        if (-not (Check $chain[$index] $true $true)) { throw 'unsafe' }
      } elseif ($request.createDirectory) { throw 'unsafe' }
      else { $missing = $true; break }
    }
  }
  $exists = $false
  if (-not $missing) { $exists = Check $request.file $false $true }
  [Console]::Out.Write((@{ ok = $true; exists = [bool]$exists } | ConvertTo-Json -Compress))
} catch {
  [Console]::Out.Write('{"ok":false}')
  exit 1
}
`;

function checkedPath(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || file.includes('\0')) throw storageError();
  const parts = file.split(WINDOWS ? /[\\/]/ : /\//);
  if (parts.includes('..') || parts.includes('.')) throw storageError();
  if (WINDOWS) {
    // Local drive paths only: exclude device namespaces, UNC shares and alternate data streams.
    if (!/^[a-zA-Z]:[\\/]/.test(file) || parts.slice(1).some((part) => /[:<>"|?*]|[. ]$/.test(part))) throw storageError();
  }
  const normalized = path.normalize(file);
  if (normalized === path.parse(normalized).root || normalized.endsWith(path.sep)) throw storageError();
  return normalized;
}

function lstatIfPresent(file) {
  try { return fs.lstatSync(file); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function checkUnix(stat, { directory = false, privateEntry = false } = {}) {
  const uid = process.getuid();
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw storageError();
  if (privateEntry) {
    if (stat.uid !== uid || (stat.mode & 0o077) !== 0) throw storageError();
  } else {
    if (stat.uid !== uid && stat.uid !== 0) throw storageError();
    // A root-owned sticky directory (e.g. /tmp) cannot unlink a user's owned child.
    if ((stat.mode & 0o022) !== 0 && !(stat.uid === 0 && (stat.mode & 0o1000) !== 0)) throw storageError();
  }
  if (!directory && stat.nlink !== 1) throw storageError();
}

function prepareUnix(file, createDirectory) {
  const parent = path.dirname(file);
  const chain = [];
  for (let cursor = parent; ; cursor = path.dirname(cursor)) {
    chain.unshift(cursor);
    if (cursor === path.parse(cursor).root) break;
  }
  for (let index = 0; index < chain.length; index++) {
    const leaf = index === chain.length - 1;
    let stat = lstatIfPresent(chain[index]);
    if (!stat) {
      if (!createDirectory) return false;
      if (!leaf) throw storageError();
      try { fs.mkdirSync(chain[index], { mode: 0o700 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      stat = fs.lstatSync(chain[index]);
    }
    checkUnix(stat, { directory: true, privateEntry: leaf });
  }
  const stat = lstatIfPresent(file);
  if (!stat) return false;
  checkUnix(stat, { privateEntry: true });
  return true;
}

/** The caller's existing .omp directory must be present before the private leaf can be created. */
export function privateRoot(home = os.homedir()) {
  return path.join(home, '.omp', 'office-private');
}

/** Validate without repairing existing permissions; optionally create only the leaf parent. */
export function preparePrivateFile(file, options = {}) {
  try {
    const { createDirectory = false } = options;
    file = checkedPath(file);
    if (typeof createDirectory !== 'boolean') throw storageError();
    if (!WINDOWS) return prepareUnix(file, createDirectory);
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const output = execFileSync(executable, ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_PREPARE], {
      input: JSON.stringify({ file, createDirectory }), encoding: 'utf8', windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'], timeout: 15_000, maxBuffer: 16 * 1024,
    });
    const result = JSON.parse(output.replace(/^\uFEFF/, ''));
    if (result.ok !== true || typeof result.exists !== 'boolean') throw storageError();
    if (result.exists) checkFileStat(fs.lstatSync(file));
    return result.exists;
  } catch { throw storageError(); }
}

function checkFileStat(stat) {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw storageError();
  if (!WINDOWS) checkUnix(stat, { privateEntry: true });
}

/** Only absence returns null. Invalid, inaccessible or insecure storage fails closed. */
export function readPrivateJson(file, options = {}) {
  let descriptor;
  try {
    const { maxBytes = 64 * 1024 } = options;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw storageError();
    file = checkedPath(file);
    if (!preparePrivateFile(file)) return null;
    const before = fs.lstatSync(file);
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const stat = fs.fstatSync(descriptor);
    checkFileStat(stat);
    if (stat.dev !== before.dev || stat.ino !== before.ino || stat.size > maxBytes) throw storageError();
    const buffer = Buffer.alloc(stat.size);
    let count = 0;
    while (count < buffer.length) {
      const bytes = fs.readSync(descriptor, buffer, count, buffer.length - count, null);
      if (bytes === 0) break;
      count += bytes;
    }
    const probe = Buffer.alloc(1);
    if (fs.readSync(descriptor, probe, 0, 1, null) !== 0) throw storageError();
    const after = fs.fstatSync(descriptor);
    checkFileStat(after);
    if (after.size !== count) throw storageError();
    fs.closeSync(descriptor);
    descriptor = undefined;
    const parsed = JSON.parse(buffer.subarray(0, count).toString('utf8'));
    if (parsed === null) throw storageError();
    return parsed;
  } catch { throw storageError(); }
  finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { throw storageError(); }
    }
  }
}

/** Synchronous, same-directory exclusive temporary write, flush, and atomic replacement. */
export function writePrivateJson(file, value) {
  let descriptor;
  let temporary;
  try {
    file = checkedPath(file);
    const json = JSON.stringify(value);
    if (json === undefined) throw storageError();
    preparePrivateFile(file, { createDirectory: true });
    const candidate = path.join(path.dirname(file), `.omp-${randomUUID()}.tmp`);
    descriptor = fs.openSync(candidate, 'wx', 0o600);
    temporary = candidate;
    checkFileStat(fs.fstatSync(descriptor));
    preparePrivateFile(temporary);
    fs.writeFileSync(descriptor, `${json}\n`, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    // Refuse an insecure target imported while the temporary file was being written.
    preparePrivateFile(file);
    fs.renameSync(temporary, file);
    temporary = undefined;
    if (!preparePrivateFile(file)) throw storageError();
  } catch { throw storageError(); }
  finally {
    let cleanupFailed = false;
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { cleanupFailed = true; }
    }
    if (temporary !== undefined) {
      try { fs.unlinkSync(temporary); }
      catch (error) { if (error.code !== 'ENOENT') cleanupFailed = true; }
    }
    if (cleanupFailed) throw storageError();
  }
}
