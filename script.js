const API_URL = "https://script.google.com/macros/s/AKfycbxEkOo8_FJEzIHRhhJtfBKcolxWzjueWTp7YMZCuTWWpeIcoocvbnawO1gVNl3DUif9/exec"; 
let userRole = "", masterIndex = [], currentFile = null, searchTimer;
let isZipLoading = false; 

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

// ==================== LOGIN HANDLING ====================
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
            document.getElementById('welcomeUser').innerText = `Welcome, ${id}`;
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('navbar').style.display = 'flex';
            document.getElementById('footer').style.display = 'flex';
            setupPortal();
        } else { msg.innerText = "Invalid Credentials"; }
    } catch(e) { msg.innerText = "Connection Failed"; }
}

// ==================== PORTAL SETUP ====================
async function setupPortal() {
    // Load batches
    fetch(`${API_URL}?action=getBatches&args=[]`).then(r => r.json()).then(data => {
        const bSel = document.getElementById('batchSelect');
        bSel.innerHTML = '<option value="">Select Batch</option>';
        data.forEach(b => bSel.add(new Option(b.name, b.id)));
    });

    // Admin-specific features
    if (userRole === 'admin') {
        document.getElementById('adminSearchWrap').style.display = 'block';
        document.getElementById('zipBtn').style.display = 'flex';
        const sBox = document.getElementById('searchBox');
        
        // Check session storage for cached index
        const sessionData = sessionStorage.getItem('vms_session_index');
        if (sessionData) {
            masterIndex = JSON.parse(sessionData);
            sBox.disabled = false;
            sBox.placeholder = `Search ${masterIndex.length} records...`;
            sBox.focus();
        } else {
            // Fetch full index with Google Drive IDs
            fetch(`${API_URL}?action=getFullIndex&args=[]`).then(r => r.json()).then(data => {
                masterIndex = data;
                sessionStorage.setItem('vms_session_index', JSON.stringify(data));
                sBox.disabled = false;
                sBox.placeholder = `Search ${data.length} records...`;
                sBox.focus();
            });
        }
    }
}

// ==================== SEARCH FUNCTIONALITY ====================
function debounceSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(executeSearch, 300);
}

function executeSearch() {
    const query = document.getElementById('searchBox').value.toLowerCase();
    const list = document.getElementById('searchSuggestions');
    list.innerHTML = '';
    if (query.length < 2) { list.style.display = 'none'; return; }

    const matches = masterIndex.filter(f => f.name.toLowerCase().includes(query)).slice(0, 40);
    if (matches.length > 0) {
        list.style.display = 'block';
        matches.forEach(m => {
            const li = document.createElement('li');
            li.className = 'suggestion-item';
            li.innerHTML = `<strong>${m.name}</strong> <span style="font-size:12px; color:#94a3b8;">${m.path}</span>`;
            li.onclick = () => {
                document.getElementById('searchBox').value = m.name;
                list.style.display = 'none';
                fetchFile(m.id);
            };
            list.appendChild(li);
        });
    } else { list.style.display = 'none'; }
}

// ==================== BATCH & CANDIDATE LOADING ====================
async function loadCandidates() {
    const batchId = document.getElementById('batchSelect').value;
    const cSel = document.getElementById('candSelect');
    if(!batchId) return;

    cSel.disabled = true;
    cSel.innerHTML = '<option value="">⏳ Loading...</option>';
    
    try {
        const data = await fetch(`${API_URL}?action=getFilesInBatch&args=${encodeURIComponent(JSON.stringify([batchId]))}`).then(r => r.json());
        cSel.innerHTML = '<option value="">Select Candidate</option>';
        data.forEach(c => cSel.add(new Option(c.name, c.id)));
    } catch(e) { cSel.innerHTML = '<option value="">❌ Error</option>'; }
    finally { cSel.disabled = false; }
}

// ==================== FILE FETCHING ====================
async function fetchFile(id) {
    const loader = document.getElementById('loader');
    loader.style.display = 'block';
    loader.innerText = "⚡ Fetching PDF...";
    document.getElementById('welcome-msg').style.display = 'none';
    document.getElementById('pdfCanvas').style.display = 'none';
    document.getElementById('dlBtn').style.display = 'none';

    try {
        const response = await fetch(`${API_URL}?action=getFileBytes&args=${encodeURIComponent(JSON.stringify([id]))}`, { priority: 'high' });
        const res = await response.json();
        if (res && res.bytes) {
            currentFile = {
                id: res.id,
                name: res.name,
                bytes: res.bytes,
                driveId: res.driveId,
                directUrl: res.directUrl
            };
            renderPdf(res.bytes);
        } else {
            throw new Error("Empty response");
        }
    } catch(e) { 
        loader.style.display = 'none';
        alert("Load Failed: " + e.message); 
    }
}

// ==================== PDF RENDERING ====================
async function renderPdf(base64) {
    try {
        const binary = window.atob(base64);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        
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
        document.getElementById('dlBtn').style.display = 'flex';
    } catch (err) {
        document.getElementById('loader').style.display = 'none';
        alert("PDF Render Error: " + err.message);
    }
}

// ==================== BATCH ZIP DOWNLOAD ====================
async function downloadBatchZip() {
    if (isZipLoading) return alert("A download is already active.");
    const batchId = document.getElementById('batchSelect').value;
    const batchText = document.getElementById('batchSelect').options[document.getElementById('batchSelect').selectedIndex].text;
    if(!batchId) return alert("Select a batch first.");

    isZipLoading = true;
    const loader = document.getElementById('loader');
    const barWrap = document.getElementById('zip-progress');
    const bar = document.getElementById('zip-bar');
    
    loader.style.display = 'block';
    barWrap.style.display = 'block';
    bar.style.width = "0%";
    loader.innerText = "🚀 Speed Fetching...";

    try {
        const fileList = await fetch(`${API_URL}?action=getFilesInBatch&args=${encodeURIComponent(JSON.stringify([batchId]))}`).then(r => r.json());
        const zip = new JSZip();
        const chunkSize = 5;
        let completed = 0;

        for (let i = 0; i < fileList.length; i += chunkSize) {
            const chunk = fileList.slice(i, i + chunkSize);
            await Promise.all(chunk.map(async (file) => {
                const fData = await fetch(`${API_URL}?action=getFileBytes&args=${encodeURIComponent(JSON.stringify([file.id]))}`).then(r => r.json());
                zip.file(`${file.name}.pdf`, fData.bytes, {base64: true});
                completed++;
                bar.style.width = Math.round((completed / fileList.length) * 100) + "%";
            }));
        }

        loader.innerText = "📦 Finalizing Zip...";
        const contentBase64 = await zip.generateAsync({type:"base64"});
        const fileName = `Batch_${batchText}.zip`;

        // Mobile/APK handling
        if (window.Android && window.Android.downloadFile) {
            window.Android.downloadFile(contentBase64, fileName, "application/zip");
        } else {
            // Browser fallback
            saveAs(await zip.generateAsync({type:"blob"}), fileName);
        }
        
        showToast("✅ ZIP Processed!");
    } catch(e) { alert("Error: " + e.message); }
    finally {
        isZipLoading = false;
        loader.style.display = 'none';
        barWrap.style.display = 'none';
    }
}

// ==================== SINGLE FILE DOWNLOAD ====================
function initiateDownload() {
    if (!currentFile) {
        return alert("Error: No file selected.");
    }

    // Priority 1: Use direct Google Drive download link (fastest)
    if (currentFile.directUrl) {
        downloadViaDirectLink(currentFile.directUrl, currentFile.name);
        return;
    }

    // Priority 2: Use Google Drive ID to construct link
    if (currentFile.driveId) {
        const directLink = `https://drive.google.com/uc?export=download&id=${currentFile.driveId}`;
        downloadViaDirectLink(directLink, currentFile.name);
        return;
    }

    // Fallback: Download from base64 data
    downloadFromBase64();
}

function downloadViaDirectLink(url, fileName) {
    showToast("🚀 Starting download...");
    
    // Create download link
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || "certificate.pdf";
    a.target = '_blank';
    
    // Different handling for mobile vs desktop
    if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        // Mobile devices - open in new tab
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        
        // Also try to trigger system download
        setTimeout(() => {
            window.location.href = url;
        }, 100);
    } else {
        // Desktop - standard download
        document.body.appendChild(a);
        a.click();
    }
    
    // Cleanup
    setTimeout(() => {
        if (a.parentNode) document.body.removeChild(a);
    }, 1000);
    
    showToast("✅ Download started!");
}

function downloadFromBase64() {
    try {
        const binary = window.atob(currentFile.bytes);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = currentFile.name || "certificate.pdf";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showToast("✅ Download Complete!");
    } catch (error) {
        alert("Download failed: " + error.message);
    }
}

// ==================== HELPER FUNCTIONS ====================
function showToast(msg) {
    const t = document.getElementById('toast');
    t.innerText = msg;
    t.style.display = 'block';
    setTimeout(() => { t.style.display = 'none'; }, 3000);
}

window.onclick = (e) => { 
    if (!e.target.closest('.search-container')) {
        document.getElementById('searchSuggestions').style.display = 'none';
    } 
};

// ==================== ENTER KEY SUPPORT FOR LOGIN ====================
document.addEventListener('DOMContentLoaded', function() {
    const uidInput = document.getElementById('uid');
    const passInput = document.getElementById('pass');
    
    if (uidInput && passInput) {
        // Press Enter in username field goes to password
        uidInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                passInput.focus();
            }
        });
        
        // Press Enter in password field triggers login
        passInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                handleLogin();
            }
        });
    }
});
