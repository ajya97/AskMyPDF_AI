/* ==========================================================================
   Pdf_Bot – front-end
   One page: library sidebar (upload / remove PDFs) + chat with cited answers.
   ========================================================================== */
(() => {
  'use strict';

  // ---------- Small helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const NS = 'http://www.w3.org/2000/svg';
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Create an element: h('div', {class:'x', onclick:fn}, child, 'text') */
  function h(tag, attrs = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [key, val] of Object.entries(attrs)) {
      if (val == null || val === false) continue;
      if (key === 'class') node.className = val;
      else if (key === 'text') node.textContent = val;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), val);
      else node.setAttribute(key, val === true ? '' : val);
    }
    kids.flat().forEach((k) => k != null && node.append(k.nodeType ? k : document.createTextNode(k)));
    return node;
  }

  function icon(id, size = 18, cls) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('aria-hidden', 'true');
    if (cls) svg.setAttribute('class', cls);
    const use = document.createElementNS(NS, 'use');
    use.setAttribute('href', '#i-' + id);
    svg.append(use);
    return svg;
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  // ---------- Elements ----------
  const el = {
    side: $('#side'), scrim: $('#scrim'), openSide: $('#openSide'), closeSide: $('#closeSide'),
    addBtn: $('#addBtn'), fileInput: $('#fileInput'), drop: $('#drop'), dropErr: $('#dropErr'),
    jobsWrap: $('#jobsWrap'), jobs: $('#jobs'), lib: $('#lib'), libEmpty: $('#libEmpty'), libCount: $('#libCount'),
    totals: $('#totals'), clearLib: $('#clearLib'), theme: $('#theme'), themeIcon: $('#themeIcon'),
    topCount: $('#topCount'), topStatus: $('#topStatus'), newChat: $('#newChat'),
    banner: $('#banner'), bannerText: $('#bannerText'),
    welcome: $('#welcome'), chat: $('#chat'), log: $('#log'), logIn: $('#logIn'), intro: $('#intro'), chips: $('#chips'),
    jump: $('#jump'), composer: $('#composer'), q: $('#q'), send: $('#send'), count: $('#count'),
    veil: $('#veil'), toast: $('#toast'), dialog: $('#dialog'),
  };

  // ---------- State ----------
  const STORE_KEY = 'pdfbot-chat';
  const state = {
    docs: [],
    totals: { pages: 0, chunks: 0 },
    limits: { docs: 20, mb: 50 },
    llmReady: true,
    offline: false,
    jobs: [],
    pumping: false,
    busy: false,
    history: [], // {role:'user'|'assistant', text, sources?}
  };
  let jobSeq = 0;

  // ---------- Theme ----------
  function syncThemeButton() {
    const dark = document.documentElement.dataset.theme === 'dark';
    el.themeIcon.setAttribute('href', dark ? '#i-sun' : '#i-moon');
    el.theme.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  }
  el.theme.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('pdfbot-theme', next); } catch (e) { /* storage unavailable */ }
    syncThemeButton();
  });

  // ---------- Toast ----------
  let toastTimer;
  function toast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 3600);
  }

  // ---------- API ----------
  async function api(path, options) {
    try {
      const res = await fetch(path, options);
      let data = null;
      try { data = await res.json(); } catch (e) { /* non-JSON body */ }
      return { ok: res.ok && !!data && data.success !== false, status: res.status, data, network: false };
    } catch (e) {
      return { ok: false, status: 0, data: null, network: true };
    }
  }

  // ---------- Mobile drawer ----------
  const mobileMq = matchMedia('(max-width: 860px)');
  function syncInert() { el.side.inert = mobileMq.matches && !el.side.classList.contains('open'); }
  function setDrawer(open, restoreFocus = true) {
    el.side.classList.toggle('open', open);
    el.scrim.hidden = !open;
    el.openSide.setAttribute('aria-expanded', String(open));
    syncInert();
    if (open) el.closeSide.focus();
    else if (restoreFocus && mobileMq.matches) el.openSide.focus();
  }
  el.openSide.addEventListener('click', () => setDrawer(true));
  el.closeSide.addEventListener('click', () => setDrawer(false));
  el.scrim.addEventListener('click', () => setDrawer(false));
  mobileMq.addEventListener('change', () => setDrawer(false, false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.side.classList.contains('open')) setDrawer(false);
  });

  // ---------- Library ----------
  function applySummary(d) {
    state.docs = d.documents || [];
    state.totals = { pages: d.total_pages || 0, chunks: d.total_chunks || 0 };
    if (typeof d.llm_ready === 'boolean') state.llmReady = d.llm_ready;
    if (d.max_documents) state.limits.docs = d.max_documents;
    if (d.max_upload_mb) state.limits.mb = d.max_upload_mb;
    state.offline = false;
    render();
  }

  function renderLibrary() {
    el.lib.replaceChildren();
    state.docs.forEach((doc) => {
      const rm = h('button', {
        class: 'icon-btn sm doc-rm', type: 'button', 'aria-label': `Remove ${doc.filename}`,
      }, icon('x', 18));
      let timer;
      const reset = () => {
        if (!rm.isConnected) return;
        rm.classList.remove('confirm');
        rm.replaceChildren(icon('x', 18));
        rm.setAttribute('aria-label', `Remove ${doc.filename}`);
      };
      rm.addEventListener('click', async () => {
        if (!rm.classList.contains('confirm')) {
          rm.classList.add('confirm');
          rm.textContent = 'Remove?';
          rm.setAttribute('aria-label', `Confirm removing ${doc.filename}`);
          timer = setTimeout(reset, 3500);
          return;
        }
        clearTimeout(timer);
        rm.disabled = true;
        const r = await api('/documents/' + encodeURIComponent(doc.id), { method: 'DELETE' });
        if (!r.ok) {
          rm.disabled = false;
          reset();
          toast((r.data && r.data.message) || 'Could not remove this PDF. Try again.');
          return;
        }
        applySummary(r.data);
        toast(`Removed ${doc.filename}`);
        if (!state.docs.length) clearChat();
      });

      el.lib.append(
        h('li', { class: 'doc' },
          h('span', { class: 'doc-ico' }, icon('file', 18)),
          h('div', { class: 'doc-text' },
            h('p', { class: 'doc-name', title: doc.filename, text: doc.filename }),
            h('p', { class: 'doc-meta', text: plural(doc.pages, 'page') })),
          rm),
      );
    });

    const n = state.docs.length;
    el.libEmpty.hidden = n > 0;
    el.libCount.textContent = n ? `${n} of ${state.limits.docs}` : '';
    el.clearLib.hidden = n === 0;
    el.totals.textContent = n ? `${plural(n, 'PDF')}, ${plural(state.totals.pages, 'page')} indexed` : '';
    el.topCount.textContent = String(n);
    document.querySelectorAll('[data-max-docs]').forEach((s) => { s.textContent = state.limits.docs; });
    document.querySelectorAll('[data-max-mb]').forEach((s) => { s.textContent = state.limits.mb; });
  }

  el.clearLib.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Clear your library?',
      text: 'All PDFs and this chat will be removed. You can add the PDFs again later.',
      okLabel: 'Clear library',
    });
    if (!ok) return;
    const r = await api('/reset', { method: 'POST' });
    if (!r.ok) return toast('Could not clear the library. Try again.');
    applySummary(r.data);
    clearChat();
    toast('Library cleared');
  });

  function confirmDialog({ title, text, okLabel }) {
    $('#dialogTitle').textContent = title;
    $('#dialogText').textContent = text;
    $('#dialogOk').textContent = okLabel;
    el.dialog.returnValue = '';
    return new Promise((resolve) => {
      el.dialog.addEventListener('close', () => resolve(el.dialog.returnValue === 'ok'), { once: true });
      el.dialog.showModal();
    });
  }

  // ---------- Uploading ----------
  function notifyError(message) {
    if (!el.welcome.hidden) {
      el.dropErr.textContent = message;
      el.drop.classList.remove('shake');
      void el.drop.offsetWidth;
      el.drop.classList.add('shake');
    } else {
      toast(message.split('\n')[0]);
    }
  }

  function addFiles(fileList) {
    el.dropErr.textContent = '';
    const errors = [];
    const maxBytes = state.limits.mb * 1048576;

    [...fileList].forEach((file) => {
      if (!/\.pdf$/i.test(file.name)) return errors.push(`${file.name}: only PDF files are supported.`);
      if (!file.size) return errors.push(`${file.name}: the file is empty.`);
      if (file.size > maxBytes) return errors.push(`${file.name}: larger than the ${state.limits.mb} MB limit.`);
      const pending = state.jobs.filter((j) => j.status !== 'error');
      if (pending.some((j) => j.file.name === file.name && j.file.size === file.size)) return;
      if (state.docs.length + pending.length >= state.limits.docs) {
        return errors.push(`Library is full (${state.limits.docs} PDFs). Remove one to add another.`);
      }
      state.jobs.push({ id: ++jobSeq, file, status: 'queued', pct: 0, msg: '', retry: false, xhr: null });
    });

    if (errors.length) notifyError(errors.join('\n'));
    render();
    pump();
  }

  async function pump() {
    if (state.pumping) return;
    state.pumping = true;
    try {
      let job;
      while ((job = state.jobs.find((j) => j.status === 'queued'))) await uploadJob(job);
    } finally {
      state.pumping = false;
    }
  }

  function removeJob(job) {
    state.jobs = state.jobs.filter((j) => j !== job);
    renderJobs();
  }

  function failJob(job, message, retry) {
    job.status = 'error';
    job.msg = message;
    job.retry = retry;
    job.xhr = null;
    renderJobs();
  }

  function uploadJob(job) {
    return new Promise((resolve) => {
      job.status = 'uploading';
      job.pct = 0;
      renderJobs();

      const form = new FormData();
      form.append('file', job.file);
      const xhr = new XMLHttpRequest();
      job.xhr = xhr;
      xhr.open('POST', '/upload');

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        job.pct = Math.round((e.loaded / e.total) * 100);
        updateJob(job);
      };
      xhr.upload.onload = () => { job.status = 'processing'; updateJob(job); };
      xhr.onabort = () => { removeJob(job); resolve(); };
      xhr.onerror = () => {
        failJob(job, 'Network error. Check that Pdf_Bot is still running.', true);
        resolve();
      };
      xhr.onload = () => {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch (e) { /* ignore */ }
        if (xhr.status >= 200 && xhr.status < 300 && data && data.success) {
          removeJob(job);
          applySummary(data);
          toast(`Added ${data.filename}`);
        } else {
          const msg = (data && data.message) || 'Something went wrong while processing this PDF.';
          failJob(job, msg, xhr.status >= 500);
        }
        resolve();
      };
      xhr.send(form);
    });
  }

  function jobMessage(job) {
    if (job.status === 'queued') return 'Waiting in line';
    if (job.status === 'uploading') return `Uploading ${job.pct}%`;
    if (job.status === 'processing') {
      return state.docs.length ? 'Reading pages and building the index' : 'Reading pages and building the index. The first PDF can take a minute.';
    }
    return job.msg;
  }

  function updateJob(job) {
    const li = el.jobs.querySelector(`[data-id="${job.id}"]`);
    if (!li || li.dataset.status !== job.status) return renderJobs();
    const bar = li.querySelector('.bar > i');
    if (bar && job.status === 'uploading') bar.style.width = job.pct + '%';
    li.querySelector('.job-msg').textContent = jobMessage(job);
    renderTopStatus();
  }

  function renderJobs() {
    el.jobs.replaceChildren();
    state.jobs.forEach((job) => {
      const li = h('li', { class: 'job' + (job.status === 'error' ? ' error' : ''), 'data-id': job.id, 'data-status': job.status });
      const canCancel = job.status === 'queued' || job.status === 'uploading';
      const closeBtn = (job.status === 'error' || canCancel) && h('button', {
        class: 'icon-btn sm', type: 'button',
        'aria-label': (canCancel ? 'Cancel ' : 'Dismiss ') + job.file.name,
        onclick: () => (job.xhr && job.status === 'uploading' ? job.xhr.abort() : removeJob(job)),
      }, icon('x', 18));

      li.append(h('div', { class: 'job-top' }, h('p', { class: 'job-name', title: job.file.name, text: job.file.name }), closeBtn || null));

      if (job.status !== 'error') {
        const bar = h('div', { class: 'bar' + (job.status === 'processing' ? ' busy' : '') }, h('i'));
        if (job.status === 'uploading') bar.firstChild.style.width = job.pct + '%';
        li.append(bar);
      }
      li.append(h('p', { class: 'job-msg', text: jobMessage(job) }));

      if (job.status === 'error' && job.retry) {
        li.append(h('div', { class: 'job-actions' }, h('button', {
          class: 'text-btn', type: 'button', onclick: () => { job.status = 'queued'; render(); pump(); },
        }, 'Try again')));
      }
      el.jobs.append(li);
    });
    el.jobsWrap.hidden = state.jobs.length === 0;
    renderTopStatus();
  }

  el.addBtn.addEventListener('click', () => el.fileInput.click());
  el.drop.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', () => { addFiles(el.fileInput.files); el.fileInput.value = ''; });

  // Drag and drop anywhere on the page
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; el.veil.hidden = false; });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) el.veil.hidden = true;
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    el.veil.hidden = true;
    addFiles(e.dataTransfer.files);
  });

  // ---------- Header, banner, views ----------
  function renderTopStatus() {
    const active = state.jobs.filter((j) => j.status !== 'error');
    let text = '';
    if (active.length) {
      const job = active.find((j) => j.status !== 'queued') || active[0];
      const verb = job.status === 'processing' ? 'Reading' : job.status === 'uploading' ? `Uploading ${job.pct}%` : 'Waiting';
      text = active.length > 1 ? `Adding ${active.length} PDFs. ${verb}` : `${verb}: ${job.file.name}`;
    } else if (state.docs.length) {
      text = `${plural(state.docs.length, 'PDF')} ready, ${plural(state.totals.pages, 'page')}`;
    }
    el.topStatus.textContent = text;
  }

  function renderBanner() {
    el.bannerText.replaceChildren();
    if (state.offline) {
      el.bannerText.append('Cannot reach the Pdf_Bot server. Make sure the app is running, then reload this page.');
    } else if (!state.llmReady) {
      el.bannerText.append(
        'The AI key is missing, so questions cannot be answered yet. Add ',
        h('code', { text: 'LLM_API_KEY' }), ' to the ', h('code', { text: '.env' }), ' file and restart Pdf_Bot.');
    }
    el.banner.hidden = !(state.offline || !state.llmReady);
  }

  let chipSig = '';
  function renderChips() {
    const multi = state.docs.length > 1;
    const sig = String(multi);
    if (sig === chipSig) return;
    chipSig = sig;
    const prompts = ['Summarize this document', 'List the key topics', 'Make 5 practice questions', 'Explain the hardest idea simply'];
    if (multi) prompts.splice(1, 0, 'Compare the documents');
    el.chips.replaceChildren(...prompts.map((p) => h('button', { class: 'chip', type: 'button', onclick: () => submit(p) }, p)));
  }

  function render() {
    renderLibrary();
    renderJobs();
    renderBanner();
    renderChips();
    const hasDocs = state.docs.length > 0;
    el.welcome.hidden = hasDocs;
    el.chat.hidden = !hasDocs;
    el.newChat.hidden = !hasDocs || state.history.length === 0;
    updateComposer();
  }

  // ---------- Chat: markdown (escaped first, then a small safe subset) ----------
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inline = (s) => esc(s)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');

  function markdown(src) {
    let out = '';
    src.split('```').forEach((part, i) => {
      if (i % 2) {
        const nl = part.indexOf('\n');
        const code = nl > -1 ? part.slice(nl + 1) : part;
        out += '<pre><code>' + esc(code.replace(/\n$/, '')) + '</code></pre>';
        return;
      }
      let list = null;
      let para = [];
      const closeList = () => { if (list) { out += `</${list}>`; list = null; } };
      const flushPara = () => { if (para.length) { out += '<p>' + para.map(inline).join('<br>') + '</p>'; para = []; } };
      part.split('\n').forEach((line) => {
        let m;
        if ((m = line.match(/^\s*[-*•]\s+(.*)/))) {
          flushPara();
          if (list !== 'ul') { closeList(); out += '<ul>'; list = 'ul'; }
          out += '<li>' + inline(m[1]) + '</li>';
        } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
          flushPara();
          if (list !== 'ol') { closeList(); out += '<ol>'; list = 'ol'; }
          out += '<li>' + inline(m[1]) + '</li>';
        } else if ((m = line.match(/^#{1,6}\s+(.*)/))) {
          flushPara(); closeList();
          out += '<h4>' + inline(m[1]) + '</h4>';
        } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
          flushPara(); closeList();
          out += '<hr>';
        } else if (line.trim()) {
          closeList();
          para.push(line.trim());
        } else {
          flushPara(); closeList();
        }
      });
      flushPara();
      closeList();
    });
    return out;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = h('textarea', { style: 'position:fixed;opacity:0;top:0', 'aria-hidden': 'true' });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { /* ignore */ }
      ta.remove();
      return ok;
    }
  }

  // ---------- Chat: rendering ----------
  const nearBottom = () => el.log.scrollHeight - el.log.scrollTop - el.log.clientHeight < 140;
  const scrollBottom = () => el.log.scrollTo({ top: el.log.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' });

  /** Scroll so the start of a (possibly long) answer is visible. */
  function revealAnswer(node) {
    const top = node.getBoundingClientRect().top - el.log.getBoundingClientRect().top + el.log.scrollTop - 16;
    const max = el.log.scrollHeight - el.log.clientHeight;
    el.log.scrollTo({ top: Math.max(0, Math.min(top, max)), behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  function botHead() {
    return h('div', { class: 'bot-head' }, icon('mark', 30, 'bot-av'), h('span', { class: 'bot-name', text: 'Pdf_Bot' }));
  }

  function userNode(text) {
    return h('article', { class: 'msg user' }, h('span', { class: 'sr-only' }, 'You asked: '), h('div', { class: 'bubble', text }));
  }

  function botNode(msg) {
    const body = h('div', { class: 'bot-body' });
    body.append(h('span', { class: 'sr-only' }, 'Pdf_Bot answered: '));
    const prose = h('div', { class: 'prose' });
    prose.innerHTML = markdown(msg.text);
    body.append(prose);

    const sources = (msg.sources || []).filter((s) => s && s.filename);
    if (sources.length) {
      const list = h('ul', { class: 'sources', 'aria-label': 'Sources' }, h('li', { class: 'src-label', text: 'Sources' }));
      sources.forEach((s) => {
        list.append(h('li', {
          class: 'cite', title: s.page ? `${s.filename}, page ${s.page}` : s.filename,
        }, s.page ? h('span', { class: 'pg' }, `p. ${s.page}`) : null, h('span', { class: 'fn', text: s.filename })));
      });
      body.append(list);
    }

    const copyBtn = h('button', { class: 'text-btn', type: 'button' }, icon('copy', 16), h('span', { text: 'Copy' }));
    copyBtn.addEventListener('click', async () => {
      const ok = await copyText(msg.text);
      copyBtn.replaceChildren(icon(ok ? 'check' : 'copy', 16), h('span', { text: ok ? 'Copied' : 'Copy failed' }));
      setTimeout(() => copyBtn.replaceChildren(icon('copy', 16), h('span', { text: 'Copy' })), 1600);
    });
    body.append(h('div', { class: 'msg-actions' }, copyBtn));

    return h('article', { class: 'msg bot' }, botHead(), body);
  }

  function pendingNode() {
    const text = h('p', { class: 'pending-text', text: 'Searching your PDFs' });
    const node = h('article', { class: 'msg bot', 'data-pending': '' }, botHead(),
      h('div', { class: 'bot-body pending', role: 'status' },
        h('div', { class: 'pending-lines', 'aria-hidden': 'true' }, h('div', { class: 'pl' }), h('div', { class: 'pl' }), h('div', { class: 'pl' })),
        text));
    node._text = text;
    return node;
  }

  function errorNode(message, onRetry) {
    return h('article', { class: 'msg bot' }, botHead(),
      h('div', { class: 'bot-body' },
        h('div', { class: 'errbox' }, h('p', { text: message }),
          h('button', { class: 'btn ghost', type: 'button', onclick: onRetry }, 'Try again'))));
  }

  function clearMessageNodes() { el.logIn.querySelectorAll('.msg').forEach((n) => n.remove()); }

  function renderHistory() {
    clearMessageNodes();
    state.history.forEach((m) => el.logIn.append(m.role === 'user' ? userNode(m.text) : botNode(m)));
    el.intro.hidden = state.history.length > 0;
    el.newChat.hidden = el.chat.hidden || state.history.length === 0;
    el.log.scrollTop = el.log.scrollHeight;
  }

  // ---------- Chat: history persistence ----------
  function loadHistory() {
    try {
      const raw = JSON.parse(sessionStorage.getItem(STORE_KEY) || '[]');
      return Array.isArray(raw)
        ? raw.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
        : [];
    } catch (e) { return []; }
  }
  function saveHistory() {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(state.history.slice(-60))); } catch (e) { /* ignore */ }
  }
  function clearChat() {
    state.history = [];
    saveHistory();
    renderHistory();
    el.newChat.hidden = true;
  }
  el.newChat.addEventListener('click', () => { clearChat(); el.q.focus(); });

  // ---------- Chat: asking ----------
  async function ask(question) {
    state.busy = true;
    updateComposer();

    const pending = pendingNode();
    el.logIn.append(pending);
    scrollBottom();
    const slow = setTimeout(() => { pending._text.textContent = 'Still working. Free AI models can take a little while.'; }, 7000);

    const r = await api('/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });

    clearTimeout(slow);
    pending.remove();

    if (r.ok && typeof r.data.answer === 'string') {
      const msg = { role: 'assistant', text: r.data.answer, sources: r.data.sources || [] };
      state.history.push(msg);
      saveHistory();
      const node = botNode(msg);
      el.logIn.append(node);
      revealAnswer(node);
    } else {
      if (r.data && r.data.code === 'llm_not_configured') { state.llmReady = false; renderBanner(); }
      const message = r.network
        ? 'Could not reach Pdf_Bot. Check that the app is still running.'
        : (r.data && r.data.message) || 'Something went wrong. Please try again.';
      const node = errorNode(message, () => { node.remove(); ask(question); });
      el.logIn.append(node);
      scrollBottom();
    }

    state.busy = false;
    updateComposer();
    el.q.focus({ preventScroll: true });
  }

  function submit(text) {
    const question = (text != null ? text : el.q.value).trim();
    if (!question || state.busy || !state.docs.length) return;
    el.q.value = '';
    autosize();
    setDrawer(false, false);

    state.history.push({ role: 'user', text: question });
    saveHistory();
    el.intro.hidden = true;
    el.newChat.hidden = false;
    el.logIn.append(userNode(question));
    scrollBottom();
    ask(question);
  }

  // ---------- Composer ----------
  function autosize() {
    el.q.style.height = 'auto';
    el.q.style.height = Math.min(el.q.scrollHeight, 168) + 'px';
    const len = el.q.value.length;
    el.count.textContent = len > 1600 ? `${len}/2000` : '';
    el.count.classList.toggle('warn', len > 1900);
  }
  function updateComposer() {
    el.send.disabled = state.busy || !el.q.value.trim();
    el.log.setAttribute('aria-busy', String(state.busy));
  }
  el.q.addEventListener('input', () => { autosize(); updateComposer(); });
  el.q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
  });
  el.composer.addEventListener('submit', (e) => { e.preventDefault(); submit(); });

  el.log.addEventListener('scroll', () => { el.jump.hidden = nearBottom() || el.log.scrollHeight <= el.log.clientHeight; }, { passive: true });
  el.jump.addEventListener('click', scrollBottom);

  // ---------- Start ----------
  async function init() {
    syncThemeButton();
    syncInert();
    state.history = loadHistory();

    const r = await api('/documents');
    if (r.ok) {
      applySummary(r.data);
    } else {
      state.offline = true;
      render();
    }
    if (!state.docs.length && state.history.length) { state.history = []; saveHistory(); }
    renderHistory();
    if (!el.chat.hidden && !mobileMq.matches) el.q.focus({ preventScroll: true });
  }
  init();
})();
