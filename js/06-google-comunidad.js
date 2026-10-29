/* Identidad Google y Drive de la comunidad. Tokens sólo en closures durante el ingreso. */
(function (root) {
  'use strict';
  var RF = root.RF = root.RF || {};
  var DRIVE = 'https://www.googleapis.com/drive/v3/';
  var EDITOR = ''; /* demo: correo del Organismo no incluido */
  var loading = null, entering = null;
  function failure() { return new Error('No se pudo ingresar con Google o preparar la carpeta. Revisa los permisos y vuelve a intentarlo.'); }
  function configured() {
    var c = root.RF_FIREBASE_CONFIG;
    return !!(c && (c.projectId === 'rinde-facil-prueba' || c.projectId === 'rinde-facil-oficial') && c.apiKey && !/PENDIENTE/.test(c.apiKey) &&
      c.authDomain === c.projectId + '.firebaseapp.com');
  }
  function sdk() {
    if (root.firebase) return Promise.resolve(root.firebase);
    function load(name) {
      return new Promise(function (resolve, reject) {
        var script = root.document.createElement('script');
        script.src = 'https://www.gstatic.com/firebasejs/12.4.0/firebase-' + name + '-compat.js';
        script.onload = resolve; script.onerror = function () { reject(failure()); };
        root.document.head.appendChild(script);
      });
    }
    if (!loading) loading = load('app').then(function () { return load('auth'); }).then(function () { return root.firebase; }).catch(function () { loading = null; throw failure(); });
    return loading;
  }
  function request(access, path, method, body, allowMissing) {
    return root.fetch(DRIVE + path, { method: method || 'GET', headers: { Authorization: 'Bearer ' + access, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, credentials: 'omit', referrerPolicy: 'no-referrer' }).then(function (r) {
      if (allowMissing && r.status === 404) return null;
      if (!r.ok) throw failure();
      return r.json();
    });
  }
  function prepare(url, session, credential) {
    function backend(modo, folderId) {
      return RF.cloud.postRawTo(url, 'driveComunidad', { t: session.token, idToken: credential.idToken, modo: modo, folderId: folderId }).then(function (r) {
        if (!r || !r.ok) throw failure();
        return r;
      });
    }
    return backend().then(function (r) {
      if (r.folderId) return r;
      return request(credential.accessToken, 'files/generateIds?count=1&space=drive&type=files').then(function (ids) {
        if (!ids.ids || !ids.ids[0]) throw failure();
        return backend('reservar', ids.ids[0]);
      });
    }).then(function (r) {
      var id = r.folderId, path = 'files/' + encodeURIComponent(id);
      if (typeof id !== 'string' || !/^[\w-]{1,200}$/.test(id)) throw failure();
      function metadata() { return request(credential.accessToken, path + '?fields=id,name,mimeType,ownedByMe,trashed', null, null, true); }
      return metadata().then(function (file) {
        if (file) return file;
        // Un error ambiguo conserva la reserva; el siguiente ingreso consulta el MISMO ID.
        return request(credential.accessToken, 'files?fields=id', 'POST', {
          id: id, name: 'Rinde Fácil', mimeType: 'application/vnd.google-apps.folder', parents: ['root']
        }).then(metadata);
      }).then(function (file) {
        if (!file || file.id !== id || file.name !== 'Rinde Fácil' || file.mimeType !== 'application/vnd.google-apps.folder' || !file.ownedByMe || file.trashed) throw failure();
        function permissions() { return request(credential.accessToken, path + '/permissions?fields=permissions(id,type,role,emailAddress,deleted),nextPageToken'); }
        function editor(p) { return p && !p.deleted && p.type === 'user' && p.role === 'writer' && String(p.emailAddress || '').toLowerCase() === EDITOR; }
        return permissions().then(function (p) {
          if ((p.permissions || []).some(editor)) return p;
          return request(credential.accessToken, path + '/permissions?sendNotificationEmail=false&fields=id', 'POST', {
            type: 'user', role: 'writer', emailAddress: EDITOR
          }).then(permissions);
        }).then(function (p) {
          if (!(p.permissions || []).some(editor)) throw failure();
          return backend('confirmar');
        });
      });
    });
  }
  function enter(communityId, linkedSession) {
    if (entering) return entering;
    if (RF.vault.rawLegacy() || (RF.vault.meta() && !RF.vault.meta().serviceLinked)) return Promise.reject(RF.auth.blockUnlinked());
    if (!configured()) return Promise.reject(new Error('El ingreso con Google está pendiente de configuración. Puedes entrar con tu clave.'));
    var firebase, auth, session, url = linkedSession ? RF.store.get().cloud.apiUrl : (RF.cloud.approvedUrls() || [])[0];
    if (!url) return Promise.reject(failure());
    entering = sdk().then(function (f) {
      firebase = f;
      if (!f.apps.length) f.initializeApp(root.RF_FIREBASE_CONFIG);
      auth = f.auth();
      return auth.setPersistence(f.auth.Auth.Persistence.NONE);
    }).then(function () {
      var provider = new firebase.auth.GoogleAuthProvider();
      provider.addScope('https://www.googleapis.com/auth/drive.file');
      provider.setCustomParameters({ prompt: 'select_account consent' });
      return auth.signInWithPopup(provider);
    }).then(function (result) {
      var credential = result.credential;
      if (!credential || !credential.idToken || !credential.accessToken) throw failure();
      var login = linkedSession ? Promise.resolve(linkedSession) : RF.cloud.postRawTo(url, 'loginGoogleComunidad', { idToken: credential.idToken, inquilino: communityId });
      return login.then(function (r) {
        if (!r || !r.ok || !r.token || !r.inquilino) throw failure();
        session = r;
        return prepare(url, r, credential);
      });
    }).then(function () {
      if (linkedSession) return null;
      return RF.cloud.postRawTo(url, 'estadoDriveComunidad', { t: session.token }).then(function (r) {
        if (!r || !r.ok || r.cuenta !== true || !r.ready) throw failure();
        return RF.cloud.postRawTo(url, 'loadState', { t: session.token });
      }).then(function (st) {
        if (!st || st.error !== 'SIN_COPIA') return st;
        var state = RF.store.defaults();
        return RF.cloud.postRawTo(url, 'saveState', { t: session.token, state: JSON.stringify(state), baseRev: 0, force: false }).then(function (r) {
          if (!r || !r.ok || !(r.rev >= 1)) throw failure();
          return { ok: true, state: JSON.stringify(state), rev: r.rev };
        });
      });
    }).then(function (st) {
      if (linkedSession) return true;
      if (!st || (!st.ok && st.error !== 'SIN_COPIA')) throw failure();
      var state = st.ok ? RF.util.safeParse(st.state) : RF.store.defaults();
      if (!state || !Array.isArray(state.projects)) throw failure();
      return RF.auth.openGoogleAccount(session, state, url, st.rev || 0);
    }).catch(function () {
      if (session && !linkedSession) return RF.cloud.postRawTo(url, 'logout', { t: session.token }).catch(function () {}).then(function () { throw failure(); });
      throw failure();
    }).finally(function () {
      // Firebase no conserva su sesión; la sesión propia del servicio vive sólo en memoria.
      return (auth ? auth.signOut().catch(function () {}) : Promise.resolve()).then(function () { entering = null; });
    });
    return entering;
  }
  function enterOrganismo(url) {
    function rejected() { return Object.assign(new Error('No se pudo ingresar con Google.'), { code: 'INGRESO_GOOGLE_RECHAZADO' }); }
    if (!configured()) return Promise.reject(Object.assign(new Error('El ingreso con Google todavía no está configurado.'), { code: 'GOOGLE_SIN_CONFIGURAR' }));
    var firebase, auth;
    return sdk().then(function (f) {
      firebase = f;
      if (!f.apps.length) f.initializeApp(root.RF_FIREBASE_CONFIG);
      auth = f.auth();
      return auth.setPersistence(f.auth.Auth.Persistence.NONE);
    }).then(function () {
      var provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      return auth.signInWithPopup(provider);
    }).then(function (result) {
      var credential = result && result.credential;
      if (!credential || !credential.idToken) throw rejected();
      return RF.cloud.postRawTo(url, 'loginGoogleOrganismo', { idToken: credential.idToken });
    }).then(function (r) {
      if (!r || r.ok !== true || !r.token) throw rejected();
      return r;
    }).finally(function () {
      return auth ? auth.signOut().catch(function () {}) : Promise.resolve();
    });
  }
  function connectDrive() {
    return RF.auth.ensureSession().then(function (token) {
      return enter(RF.auth.inquilino(), { ok: true, token: token, inquilino: RF.auth.inquilino() });
    });
  }
  function offerSetup() {
    var c = RF.store.get().cloud || {}, token = RF.auth.token();
    if (!token || !c.inquilino || !RF.ui.choiceBox) return Promise.resolve();
    return RF.cloud.postRawTo(c.apiUrl, 'estadoDriveComunidad', { t: token }).then(function (r) {
      if (!r || !r.ok || r.ready) return;
      return RF.ui.choiceBox('Autoriza con Google crear «Rinde Fácil» en tu Drive y compartirla con edición con el Organismo. Hasta prepararla no podrás guardar documentos en Drive.',
        [{ id: 'prepare', label: 'Preparar mi carpeta', primary: true }, { id: 'later', label: 'Más tarde' }]).then(function (choice) {
        if (choice === 'prepare') return connectDrive();
      });
    }).catch(function () { RF.ui.toast('No se pudo preparar la carpeta. Puedes reintentar desde Seguridad.', 'bad'); });
  }
  RF.googleComunidad = { enter: enter, connectDrive: connectDrive, offerSetup: offerSetup, configured: configured };
  RF.googleOrganismo = { enter: enterOrganismo, configured: configured };
})(typeof window !== 'undefined' ? window : globalThis);
