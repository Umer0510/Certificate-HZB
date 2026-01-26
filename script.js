const API_URL = "https://script.google.com/macros/s/AKfycbxH8HsN9yZPz1XE7rxoE4deEZeuRyOSvOe0S4Ngi8zjXOvi67cS3HjijoWoHpayKtwX/exec"; 
let userRole = "", masterIndex = [], currentFile = null, searchTimer;
let isZipLoading = false; 

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

// Check if running in WebView/APK
const isAndroidApp = () => {
    return /Android/i.test(navigator.userAgent) && 
           !/Chrome/i.test(navigator.userAgent) || 
           typeof Android !== 'undefined';
};

// Check if running in iOS
const isIOSApp = () => {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent) && 
           !/Safari/i.test(navigator.userAgent) ||
           (window.webkit && window.webkit.messageHandlers);
};

// Check if we're in a mobile WebView
const isMobileApp = () => isAndroidApp() || isIOSApp();

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

async function setupPortal() {
    fetch(`${API_URL}?action=getBatches&args=[]`).then(r => r.json()).then(data => {
        const bSel = document.getElementById('batchSelect');
        bSel.innerHTML = '<option value="">Select Batch</option>';
        data.forEach(b => bSel.add(new Option(b.name, b.id)));
    });

    if (userRole === 'admin') {
        document.getElementById('adminSearchWrap').style.display = 'block';
        document.getElementById('zipBtn').style.display = 'flex';
        const sBox = document.getElementById('searchBox');
        
        const sessionData = sessionStorage.getItem('vms_session_index');
        if (sessionData) {
            masterIndex = JSON.parse(sessionData);
            sBox.disabled = false;
            sBox.placeholder = `Search ${masterIndex.length} records...`;
            sBox.focus();
        } else {
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

    cSel.disabled = true;
    cSel.innerHTML = '<option value="">⏳ Loading...</option>';
    
    try {
        const data = await fetch(`${API_URL}?action=getFilesInBatch&args=${encodeURIComponent(JSON.stringify([batchId]))}`).then(r => r.json());
        cSel.innerHTML = '<option value="">Select Candidate</option>';
        data.forEach(c => cSel.add(new Option(c.name, c.id)));
    } catch(e) { cSel.innerHTML = '<option value="">❌ Error</option>'; }
    finally { cSel.disabled = false; }
}

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
            currentFile = res;
            renderPdf(res.bytes);
        } else {
            throw new Error("Empty response");
        }
    } catch(e) { 
        loader.style.display = 'none';
        alert("Load Failed: " + e.message); 
    }
}

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
    loader.innerText = "🚀 Starting Parallel Fetch...";

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
                const pct = Math.round((completed / fileList.length) * 100);
                bar.style.width = pct + "%";
                loader.innerText = `📥 Downloading: ${completed}/${fileList.length}`;
            }));
        }

        loader.innerText = "📦 Saving Zip...";
        const content = await zip.generateAsync({type:"blob"});
        
        // Universal download for ZIP
        if (isMobileApp()) {
            // For mobile apps, use a different approach
            const reader = new FileReader();
            reader.onload = function() {
                const base64Zip = reader.result.split(',')[1];
                downloadFileUniversal(`${batchText}_batch.zip`, base64Zip, 'application/zip');
            };
            reader.readAsDataURL(content);
        } else {
            // For regular browsers
            saveAs(content, `Batch_${batchText}.zip`);
        }
        
        showToast("✅ ZIP Downloaded Successfully!");
    } catch(e) { alert("Error: " + e.message); }
    finally {
        isZipLoading = false;
        loader.style.display = 'none';
        barWrap.style.display = 'none';
    }
}

// Universal download function for all platforms
function downloadCurrentFile() {
    if (!currentFile) return;
    
    const base64Data = currentFile.bytes; 
    const fileName = currentFile.name || "certificate.pdf";
    
    // Show downloading toast
    showToast("⏳ Downloading PDF...");
    
    // Use universal download function
    downloadFileUniversal(fileName, base64Data, 'application/pdf');
}

// Main universal download function
function downloadFileUniversal(fileName, base64Data, mimeType) {
    // Decode base64 to binary
    const binary = window.atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    
    // Create blob
    const blob = new Blob([bytes], { type: mimeType });
    
    if (isMobileApp()) {
        // For mobile WebView/APK - use multiple fallback methods
        downloadForMobileApp(fileName, blob, bytes);
    } else {
        // For regular browsers (Desktop & Mobile Safari/Chrome)
        downloadForBrowser(fileName, blob);
    }
}

// Download for regular browsers
function downloadForBrowser(fileName, blob) {
    try {
        // Method 1: Use FileSaver.js (included)
        saveAs(blob, fileName);
        
        // Method 2: Fallback to createObjectURL
        setTimeout(() => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            
            // Cleanup
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);
        }, 100);
        
        showToast("✅ Download Started!");
    } catch (error) {
        console.error("Browser download failed:", error);
        showToast("❌ Download Failed - Try Again");
    }
}

// Download for Mobile App (WebView/APK)
function downloadForMobileApp(fileName, blob, bytes) {
    // Method 1: Try Android bridge if available
    if (window.Android && window.Android.downloadFile) {
        try {
            // Convert to base64 for Android bridge
            const base64 = btoa(String.fromCharCode(...bytes));
            window.Android.downloadFile(base64, fileName, 'application/pdf');
            showToast("⏳ Opening in App...");
            return;
        } catch (e) {
            console.warn("Android bridge failed:", e);
        }
    }
    
    // Method 2: Try iOS bridge if available
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.downloadHandler) {
        try {
            const reader = new FileReader();
            reader.onload = function() {
                const base64 = reader.result.split(',')[1];
                window.webkit.messageHandlers.downloadHandler.postMessage({
                    fileName: fileName,
                    base64Data: base64,
                    mimeType: 'application/pdf'
                });
            };
            reader.readAsDataURL(blob);
            showToast("⏳ Opening in App...");
            return;
        } catch (e) {
            console.warn("iOS bridge failed:", e);
        }
    }
    
    // Method 3: Use blob URL with iframe (works in many WebViews)
    try {
        const url = URL.createObjectURL(blob);
        
        // Try opening in new window/tab
        const newWindow = window.open(url, '_blank');
        if (newWindow) {
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            showToast("✅ Opening PDF...");
        } else {
            // If popup blocked, use iframe
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.src = url;
            document.body.appendChild(iframe);
            setTimeout(() => {
                document.body.removeChild(iframe);
                URL.revokeObjectURL(url);
            }, 1000);
            showToast("✅ PDF Loaded");
        }
    } catch (error) {
        console.error("Mobile download failed:", error);
        
        // Method 4: Last resort - use data URL (limited size)
        if (bytes.length < 10000000) { // 10MB limit
            const reader = new FileReader();
            reader.onload = function() {
                const dataUrl = reader.result;
                const link = document.createElement('a');
                link.href = dataUrl;
                link.download = fileName;
                link.style.display = 'none';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            };
            reader.readAsDataURL(blob);
        } else {
            alert("File too large for mobile download. Please use desktop browser.");
        }
    }
}

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

// Handle Enter key in login
document.addEventListener('keypress', function(e) {
    if (e.key === 'Enter' && document.getElementById('login-screen').style.display !== 'none') {
        handleLogin();
    }
});

// Initialize when page loads
document.addEventListener('DOMContentLoaded', function() {
    // Auto-focus username field
    const uidField = document.getElementById('uid');
    if (uidField) uidField.focus();
});
