const API_URL = "https://script.google.com/macros/s/AKfycbxH8HsN9yZPz1XE7rxoE4deEZeuRyOSvOe0S4Ngi8zjXOvi67cS3HjijoWoHpayKtwX/exec"; 
let userRole = "", masterIndex = [], currentFile = null, searchTimer;

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

async function handleLogin() {
    const id = document.getElementById('uid').value;
    const ps = document.getElementById('pass').value;
    const msg = document.getElementById('msg');
    if(!id || !ps) return;

    msg.innerText = "Authenticating...";
    try {
        const res = await fetch(`${API_URL}?action=checkLogin&args=${encodeURIComponent(JSON.stringify([id,ps]))}`).then(r => r.json());
        if (res && res.role) {
            userRole = res.role;
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('navbar').style.display = 'flex';
            document.getElementById('footer').style.display = 'flex';
            setupPortal();
        } else { msg.innerText = "Access Denied: Invalid Credentials"; }
    } catch(e) { msg.innerText = "Connection Failed"; }
}

async function setupPortal() {
    fetch(`${API_URL}?action=getBatches&args=[]`).then(r => r.json()).then(data => {
        const bSel = document.getElementById('batchSelect');
        bSel.innerHTML = '<option value="">Batch</option>';
        data.forEach(b => bSel.add(new Option(b.name, b.id)));
    });

    if (userRole === 'admin') {
        document.getElementById('adminSearchWrap').style.display = 'block';
        const cache = localStorage.getItem('vms_premium_cache');
        if (cache) { masterIndex = JSON.parse(cache); enableSearch(); }
        fetch(`${API_URL}?action=getFullIndex&args=[]`).then(r => r.json()).then(data => {
            masterIndex = data;
            localStorage.setItem('vms_premium_cache', JSON.stringify(data));
            enableSearch();
        });
    }
}

function enableSearch() {
    const sBox = document.getElementById('searchBox');
    sBox.disabled = false;
    sBox.placeholder = `Search ${masterIndex.length} records...`;
}

function debounceSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(executeSearch, 300);
}

function executeSearch() {
    const query = document.getElementById('searchBox').value.toLowerCase();
    const list = document.getElementById('searchSuggestions');
    list.innerHTML = '';
    if (query.length < 2) { list.style.display = 'none'; return; }

    const matches = masterIndex.filter(f => f.name.toLowerCase().includes(query)).slice(0, 30);
    if (matches.length > 0) {
        list.style.display = 'block';
        matches.forEach(m => {
            const li = document.createElement('li');
            li.className = 'suggestion-item';
            li.innerHTML = `<strong>${m.name}</strong>`;
            li.onclick = () => {
                document.getElementById('searchBox').value = m.name;
                list.style.display = 'none';
                fetchFile(m.id);
            };
            list.appendChild(li);
        });
    } else { list.style.display = 'none'; }
}

async function loadCandidates() {
    const batchId = document.getElementById('batchSelect').value;
    const cSel = document.getElementById('candSelect');
    if(!batchId) return;
    cSel.innerHTML = '<option value="">...</option>';
    const data = await fetch(`${API_URL}?action=getFilesInBatch&args=${encodeURIComponent(JSON.stringify([batchId]))}`).then(r => r.json());
    cSel.innerHTML = '<option value="">Candidates</option>';
    data.forEach(c => cSel.add(new Option(c.name, c.id)));
}

async function fetchFile(id) {
    document.getElementById('loader').style.display = 'block';
    document.getElementById('welcome-msg').style.display = 'none';
    document.getElementById('pdfCanvas').style.display = 'none';
    document.getElementById('dlBtn').style.display = 'none';
    try {
        const res = await fetch(`${API_URL}?action=getFileBytes&args=${encodeURIComponent(JSON.stringify([id]))}`).then(r => r.json());
        currentFile = res;
        renderPdf(res.bytes);
    } catch(e) { alert("Error"); }
}

async function renderPdf(base64) {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const pdf = await pdfjsLib.getDocument({data: bytes}).promise;
    const page = await pdf.getPage(1);
    const canvas = document.getElementById('pdfCanvas');
    const context = canvas.getContext('2d');
    const containerWidth = document.getElementById('viewer-area').clientWidth - 40;
    const unscaledViewport = page.getViewport({scale: 1});
    const scale = containerWidth / unscaledViewport.width;
    const viewport = page.getViewport({scale: scale});
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    await page.render({canvasContext: context, viewport: viewport}).promise;
    document.getElementById('loader').style.display = 'none';
    canvas.style.display = 'block';
    document.getElementById('dlBtn').style.display = 'block';
}

function initiateDownload() {
    if(!currentFile) return;
    const byteCharacters = atob(currentFile.bytes);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], {type: 'application/pdf'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentFile.name || "certificate.pdf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function handleLogout() { location.reload(); }

window.onclick = (e) => { 
    if (!e.target.closest('.search-container')) {
        document.getElementById('searchSuggestions').style.display = 'none';
    } 
};