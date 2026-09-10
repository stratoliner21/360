// デスクトップアプリの画面コード(HTML/JS/CSS)を自動更新するための配信元。
// デスクトップアプリはGoogleの認証情報を持たないため、Google Driveには直接アクセスしない。
// 代わりにこのAPIがサーバー側でDrive上の指定ファイルを読み、内容を返す。
//
// 配信するのは画面コードのみで、Electron本体(exe)やmain.js/preload.jsは対象外。
// 更新の公開は、スクリプトプロパティ APP_UPDATE_DRIVE_FILE_ID が指すDriveファイルの
// 内容(JSON)を差し替えることで行う(ファイルIDは固定のまま「新しいバージョンをアップロード」する運用を想定)。
//
// Driveファイルの形式:
// { "version": "1.0.1", "files": { "index.html": "...", "renderer.js": "...", "styles.css": "..." } }

// action: getAppUpdate
// 認証不要(起動直後、ログイン前にチェックするため)。機微情報は一切含まない。
function getAppUpdate() {
  const fileId = PropertiesService.getScriptProperties().getProperty('APP_UPDATE_DRIVE_FILE_ID');
  if (!fileId) {
    throw new ApiError(
      'CONFIG_ERROR',
      'スクリプトプロパティ APP_UPDATE_DRIVE_FILE_ID が設定されていません(デスクトップアプリ更新用Driveファイル)'
    );
  }

  let content;
  try {
    content = DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8');
  } catch (e) {
    throw new ApiError('CONFIG_ERROR', 'アプリ更新用Driveファイルの読み取りに失敗しました: ' + e.message);
  }

  let manifest;
  try {
    manifest = JSON.parse(content);
  } catch (e) {
    throw new ApiError('CONFIG_ERROR', 'アプリ更新用Driveファイルの内容がJSONとして解析できません');
  }

  if (!manifest.version || !manifest.files) {
    throw new ApiError('CONFIG_ERROR', 'アプリ更新用Driveファイルに version または files がありません');
  }

  return { success: true, version: manifest.version, files: manifest.files };
}
