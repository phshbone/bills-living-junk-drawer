/**
 * Bill's Living Junk Drawer Backend
 * Fresh standalone Google Apps Script
 *
 * Purpose:
 * - Temporary cross-device drop drawer
 * - Small links, text snippets, images, PDFs, files
 * - 7-day default expiration
 * - Optional pinning
 * - Cleanup support
 *
 * Storage:
 * - Files go into the Drive folder below
 * - Item index is auto-created as a Google Sheet in that folder
 ************************************************************/

const APP_NAME = "Bill's Living Junk Drawer";

const JUNK_FOLDER_ID = '1YxS0RiwC1reu6sJesCvYVag14iWjRPKD';

// Change this to your own simple passcode/token.
// The HTML app will send the same token with requests.
const SECRET_TOKEN = 'bills-junk-2026';

const INDEX_SPREADSHEET_NAME = 'Bills Living Junk Drawer Index';
const INDEX_SHEET_NAME = 'Items';

const RETENTION_DAYS = 7;

// Keep this conservative for Apps Script.
// You can raise it later if testing proves stable.
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const HEADERS = [
  'id',
  'type',
  'title',
  'value',
  'fileId',
  'fileName',
  'mimeType',
  'size',
  'createdAt',
  'expiresAt',
  'pinned',
  'deleted'
];

/************************************************************
 * WEB ENTRY POINTS
 ************************************************************/

function doGet(e) {
  try {
    const action = getParam_(e, 'action');

    if (!action || action === 'ping') {
      return jsonResponse_({
        ok: true,
        app: APP_NAME,
        message: "Bill's Living Junk Drawer backend is running."
      });
    }

    if (!isAuthorizedGet_(e)) {
      return jsonResponse_({
        ok: false,
        error: 'Unauthorized'
      });
    }

    if (action === 'list') {
      return listItems_();
    }

    if (action === 'cleanup') {
      return cleanupExpiredItems_();
    }

    return jsonResponse_({
      ok: false,
      error: 'Unknown GET action: ' + action
    });

  } catch (err) {
    return jsonResponse_({
      ok: false,
      error: String(err)
    });
  }
}

function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    if (!isAuthorizedPost_(data)) {
      return jsonResponse_({
        ok: false,
        error: 'Unauthorized'
      });
    }

    if (data.submissionType !== 'junkDrawer') {
      return jsonResponse_({
        ok: false,
        error: 'Wrong submissionType'
      });
    }

    const action = data.action || '';

    if (action === 'list') {
      return listItems_();
    }

    if (action === 'createText') {
      return createTextItem_(data);
    }

    if (action === 'createFile') {
      return createFileItem_(data);
    }

    if (action === 'delete') {
      return deleteItem_(data);
    }

    if (action === 'pin') {
      return pinItem_(data);
    }

    if (action === 'cleanup') {
      return cleanupExpiredItems_();
    }

    return jsonResponse_({
      ok: false,
      error: 'Unknown POST action: ' + action
    });

  } catch (err) {
    return jsonResponse_({
      ok: false,
      error: String(err)
    });
  }
}

/************************************************************
 * AUTH
 ************************************************************/

function isAuthorizedGet_(e) {
  const token = getParam_(e, 'token');
  return token === SECRET_TOKEN;
}

function isAuthorizedPost_(data) {
  return data && data.token === SECRET_TOKEN;
}

/************************************************************
 * CORE ACTIONS
 ************************************************************/

function createTextItem_(data) {
  const sheet = getIndexSheet_();

  const now = new Date();
  const expires = makeExpirationDate_(now);

  const type = data.itemType === 'link' ? 'link' : 'text';
  const value = String(data.value || '').trim();
  if (!value) {
    return jsonResponse_({ ok: false, error: 'The note or link is empty.' });
  }
  const title = data.title || makeTextTitle_(type, value);

  const id = data.id || makeId_();

  sheet.appendRow([
    id,
    type,
    title,
    value,
    '',
    '',
    '',
    '',
    now.toISOString(),
    expires.toISOString(),
    data.pinned ? 'TRUE' : 'FALSE',
    'FALSE'
  ]);

  return jsonResponse_({
    ok: true,
    id: id,
    type: type,
    title: title
  });
}

function createFileItem_(data) {
  const sheet = getIndexSheet_();
  const folder = DriveApp.getFolderById(JUNK_FOLDER_ID);

  const id = data.id || makeId_();

  const fileName = sanitizeFileName_(data.fileName || 'junk-file');
  const mimeType = data.mimeType || 'application/octet-stream';

  let base64Data = data.base64Data || '';

  if (!base64Data) {
    return jsonResponse_({
      ok: false,
      error: 'Missing base64Data'
    });
  }

  // Accept either raw base64 or full data URL.
  if (base64Data.indexOf(',') !== -1) {
    base64Data = base64Data.split(',').pop();
  }

  const bytes = Utilities.base64Decode(base64Data);

  if (bytes.length > MAX_FILE_SIZE_BYTES) {
    return jsonResponse_({
      ok: false,
      error: 'File too large. Max allowed is ' + MAX_FILE_SIZE_BYTES + ' bytes.'
    });
  }

  const blob = Utilities.newBlob(bytes, mimeType, fileName);
  const file = folder.createFile(blob);

  // Convenience for cross-device download. Some Workspace administrators block
  // public link sharing, so a policy failure should not lose the uploaded file.
  let sharedByLink = false;
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    sharedByLink = true;
  } catch (err) {
    // The owner can still open the Drive view URL while signed in.
  }

  const now = new Date();
  const expires = makeExpirationDate_(now);

  sheet.appendRow([
    id,
    'file',
    fileName,
    '',
    file.getId(),
    fileName,
    mimeType,
    bytes.length,
    now.toISOString(),
    expires.toISOString(),
    data.pinned ? 'TRUE' : 'FALSE',
    'FALSE'
  ]);

  return jsonResponse_({
    ok: true,
    id: id,
    type: 'file',
    title: fileName,
    fileId: file.getId(),
    downloadUrl: makeDownloadUrl_(file.getId()),
    viewUrl: file.getUrl(),
    sharedByLink: sharedByLink
  });
}

function listItems_() {
  const sheet = getIndexSheet_();
  const values = sheet.getDataRange().getValues();

  const now = new Date();
  const items = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];

    const deleted = bool_(row[11]);
    if (deleted) continue;

    const id = row[0];
    if (!id) continue;

    const type = row[1];
    const fileId = row[4];
    const pinned = bool_(row[10]);

    const expiresAt = row[9] ? new Date(row[9]) : null;
    const stale = !pinned && expiresAt && expiresAt.getTime() < now.getTime();

    const item = {
      id: id,
      type: type,
      title: row[2],
      value: row[3],
      fileId: fileId,
      fileName: row[5],
      mimeType: row[6],
      size: row[7],
      createdAt: normalizeDateValue_(row[8]),
      expiresAt: normalizeDateValue_(row[9]),
      pinned: pinned,
      deleted: false,
      stale: !!stale
    };

    if (fileId) {
      item.downloadUrl = makeDownloadUrl_(fileId);
      item.viewUrl = makeViewUrl_(fileId);
    }

    items.push(item);
  }

  items.sort(function(a, b) {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return jsonResponse_({
    ok: true,
    retentionDays: RETENTION_DAYS,
    count: items.length,
    items: items
  });
}

function deleteItem_(data) {
  const id = data.id;

  if (!id) {
    return jsonResponse_({
      ok: false,
      error: 'Missing id'
    });
  }

  const sheet = getIndexSheet_();
  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    const row = values[i];

    if (String(row[0]) === String(id)) {
      const fileId = row[4];

      // Mark deleted in index.
      sheet.getRange(i + 1, 12).setValue('TRUE');

      // Trash the file if present.
      if (fileId) {
        try {
          DriveApp.getFileById(fileId).setTrashed(true);
        } catch (err) {
          // Index still gets marked deleted even if Drive trash fails.
        }
      }

      return jsonResponse_({
        ok: true,
        deleted: id
      });
    }
  }

  return jsonResponse_({
    ok: false,
    error: 'Item not found'
  });
}

function pinItem_(data) {
  const id = data.id;

  if (!id) {
    return jsonResponse_({
      ok: false,
      error: 'Missing id'
    });
  }

  const pinned = data.pinned ? 'TRUE' : 'FALSE';

  const sheet = getIndexSheet_();
  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) {
      sheet.getRange(i + 1, 11).setValue(pinned);

      return jsonResponse_({
        ok: true,
        id: id,
        pinned: data.pinned ? true : false
      });
    }
  }

  return jsonResponse_({
    ok: false,
    error: 'Item not found'
  });
}

function cleanupExpiredItems_() {
  const sheet = getIndexSheet_();
  const values = sheet.getDataRange().getValues();

  const now = new Date();

  let cleaned = 0;
  let filesTrashed = 0;

  for (let i = 1; i < values.length; i++) {
    const row = values[i];

    const id = row[0];
    const fileId = row[4];
    const expiresAt = row[9] ? new Date(row[9]) : null;
    const pinned = bool_(row[10]);
    const deleted = bool_(row[11]);

    if (!id || deleted || pinned || !expiresAt) continue;

    if (expiresAt.getTime() < now.getTime()) {
      sheet.getRange(i + 1, 12).setValue('TRUE');
      cleaned++;

      if (fileId) {
        try {
          DriveApp.getFileById(fileId).setTrashed(true);
          filesTrashed++;
        } catch (err) {
          // Continue cleanup even if one file fails.
        }
      }
    }
  }

  return jsonResponse_({
    ok: true,
    cleaned: cleaned,
    filesTrashed: filesTrashed,
    message: cleaned
      ? 'Oscar Madison cleanup complete.'
      : 'No stale junk found.'
  });
}

/************************************************************
 * INDEX SHEET SETUP
 ************************************************************/

function getIndexSheet_() {
  const folder = DriveApp.getFolderById(JUNK_FOLDER_ID);
  const properties = PropertiesService.getScriptProperties();

  // Reuse the exact index spreadsheet after first setup. This avoids relying
  // on a name search every time and prevents duplicate indexes.
  const savedId = properties.getProperty('JUNK_INDEX_SPREADSHEET_ID');
  if (savedId) {
    try {
      const savedSpreadsheet = SpreadsheetApp.openById(savedId);
      let savedSheet = savedSpreadsheet.getSheetByName(INDEX_SHEET_NAME);
      if (!savedSheet) {
        savedSheet = savedSpreadsheet.getSheets()[0];
        savedSheet.setName(INDEX_SHEET_NAME);
      }
      ensureHeaders_(savedSheet);
      return savedSheet;
    } catch (err) {
      properties.deleteProperty('JUNK_INDEX_SPREADSHEET_ID');
    }
  }

  let spreadsheetFile = null;
  const matches = folder.getFilesByName(INDEX_SPREADSHEET_NAME);

  while (matches.hasNext()) {
    const file = matches.next();

    if (file.getMimeType() === MimeType.GOOGLE_SHEETS) {
      spreadsheetFile = file;
      break;
    }
  }

  let ss;

  if (spreadsheetFile) {
    ss = SpreadsheetApp.openById(spreadsheetFile.getId());
  } else {
    ss = SpreadsheetApp.create(INDEX_SPREADSHEET_NAME);

    const file = DriveApp.getFileById(ss.getId());
    file.moveTo(folder);
  }

  properties.setProperty('JUNK_INDEX_SPREADSHEET_ID', ss.getId());

  let sheet = ss.getSheetByName(INDEX_SHEET_NAME);

  if (!sheet) {
    sheet = ss.getSheets()[0];
    sheet.setName(INDEX_SHEET_NAME);
  }

  ensureHeaders_(sheet);

  return sheet;
}

function ensureHeaders_(sheet) {
  const firstRow = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  const isEmpty = firstRow.join('').trim() === '';

  if (isEmpty) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  } else if (firstRow.join('|') !== HEADERS.join('|')) {
    throw new Error('The index sheet headers do not match this Junk Drawer version. Rename the old index sheet before retrying.');
  }
}

/************************************************************
 * HELPERS
 ************************************************************/

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getParam_(e, key) {
  return (e && e.parameter && e.parameter[key]) || '';
}

function makeId_() {
  return 'junk_' + Date.now() + '_' + Math.floor(Math.random() * 1000000);
}

function makeExpirationDate_(startDate) {
  return new Date(startDate.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

function makeDownloadUrl_(fileId) {
  return 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(fileId);
}

function makeViewUrl_(fileId) {
  return 'https://drive.google.com/file/d/' + encodeURIComponent(fileId) + '/view';
}

function bool_(value) {
  return String(value).toUpperCase() === 'TRUE' || value === true;
}

function normalizeDateValue_(value) {
  if (!value) return '';

  if (Object.prototype.toString.call(value) === '[object Date]') {
    return value.toISOString();
  }

  return String(value);
}

function sanitizeFileName_(name) {
  return String(name)
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 180);
}

function makeTextTitle_(type, value) {
  const trimmed = String(value || '').trim();

  if (!trimmed) {
    return type === 'link' ? 'Untitled link' : 'Untitled note';
  }

  if (type === 'link') {
    try {
      const url = new URL(trimmed);
      return url.hostname || trimmed.slice(0, 60);
    } catch (err) {
      return trimmed.slice(0, 60);
    }
  }

  return trimmed.slice(0, 60);
}

/************************************************************
 * OPTIONAL MANUAL TEST FUNCTIONS
 * You can run these inside Apps Script while setting up.
 ************************************************************/

function testBackendSetup() {
  const sheet = getIndexSheet_();

  return {
    ok: true,
    folderId: JUNK_FOLDER_ID,
    sheetName: sheet.getName(),
    message: 'Setup looks good.'
  };
}

function testCreateSampleNote() {
  return createTextItem_({
    itemType: 'text',
    title: 'Test note',
    value: 'This is a test note from Apps Script.',
    pinned: false
  });
}

function testCleanup() {
  return cleanupExpiredItems_();
}
