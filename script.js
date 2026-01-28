const API_URL = "https://script.google.com/macros/s/AKfycbxEkOo8_FJEzIHRhhJtfBKcolxWzjueWTp7YMZCuTWWpeIcoocvbnawO1gVNl3DUif9/exec"; 
let userRole = "", masterIndex = [], currentFile = null, searchTimer;
let isZipLoading = false, downloadType = 'single'; // 'single' or 'zip'
let currentZipData = null;

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
                driveId: res.driveId || res.id,
                directUrl: res.directUrl || `https://drive.google.com/uc?export=download&id=${res.id}`
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

// ==================== MODAL FUNCTIONS ====================
function showDownloadModal() {
    if (!currentFile) {
        alert("Please select a file first.");
        return;
    }
    
    downloadType = 'single';
    document.getElementById('modal-title').textContent = 'Download PDF';
    document.getElementById('modal-message').textContent = `Download "${currentFile.name}"`;
    document.getElementById('download-modal').style.display = 'flex';
}

function showZipDownloadModal() {
    const batchId = document.getElementById('batchSelect').value;
    const batchText = document.getElementById('batchSelect').options[document.getElementById('batchSelect').selectedIndex].text;
    
    if(!batchId) {
        alert("Select a batch first.");
        return;
    }
    
    downloadType = 'zip';
    document.getElementById('modal-title').textContent = 'Download Batch ZIP';
    document.getElementById('modal-message').textContent = `Download "${batchText}" batch as ZIP file`;
    document.getElementById('download-modal').style.display = 'flex';
}

function hideDownloadModal() {
    document.getElementById('download-modal').style.display = 'none';
}

// ==================== DOWNLOAD HANDLERS ====================
async function proceedDirectDownload() {
    hideDownloadModal();
    
    if (downloadType === 'single') {
        downloadSingleFileDirect();
    } else {
        // For ZIP, we'll use the reliable method
        downloadBatchZipReliable();
    }
}

async function proceedBase64Download() {
    hideDownloadModal();
    
    if (downloadType === 'single') {
        downloadSingleFileBase64();
    } else {
        downloadBatchZipReliable();
    }
}

// ==================== SINGLE FILE DOWNLOAD ====================
function downloadSingleFileDirect() {
    if (!currentFile || !currentFile.directUrl) {
        alert("Download URL not available. Using alternative method.");
        downloadSingleFileBase64();
        return;
    }
    
    showToast("Starting download...");
    
    // Method 1: Create a download link
    const link = document.createElement('a');
    link.href = currentFile.directUrl;
    link.download = currentFile.name;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    
    // Method 2: Create an iframe (works better in some browsers)
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = currentFile.directUrl;
    
    // Append both to body
    document.body.appendChild(link);
    document.body.appendChild(iframe);
    
    // Try clicking the link
    setTimeout(() => {
        link.click();
        
        // Also try to trigger download via window.open for mobile
        if (isMobileDevice()) {
            window.open(currentFile.directUrl, '_blank');
        }
        
        // Clean up
        setTimeout(() => {
            if (link.parentNode) document.body.removeChild(link);
            if (iframe.parentNode) document.body.removeChild(iframe);
            
            // Show instruction for mobile users
            if (isMobileDevice()) {
                setTimeout(() => {
                    showToast("Check your browser downloads or notifications");
                }, 1000);
            }
        }, 1000);
    }, 100);
}

function downloadSingleFileBase64() {
    if (!currentFile || !currentFile.bytes) {
        alert("File data not available.");
        return;
    }
    
    showToast("Preparing download...");
    
    try {
        // Convert base64 to blob
        const binary = window.atob(currentFile.bytes);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const fileName = currentFile.name.replace('.pdf', '') + '.pdf';
        
        // Create download link
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        
        // For mobile, we need to append it first
        document.body.appendChild(link);
        
        // Create and dispatch click event
        if (document.createEvent) {
            const event = document.createEvent('MouseEvents');
            event.initEvent('click', true, true);
            link.dispatchEvent(event);
        } else {
            link.click();
        }
        
        // Clean up
        setTimeout(() => {
            if (link.parentNode) {
                document.body.removeChild(link);
            }
            URL.revokeObjectURL(url);
            showToast("✅ Download started!");
            
            // Additional instruction for mobile
            if (isMobileDevice()) {
                setTimeout(() => {
                    alert("If download doesn't start automatically:\n1. Look for download notifications\n2. Check your Downloads folder\n3. Try 'Direct Download' method");
                }, 1500);
            }
        }, 100);
        
    } catch (error) {
        console.error("Download error:", error);
        alert("Download failed. Please try 'Direct Download' method instead.");
    }
}

// ==================== BATCH ZIP DOWNLOAD ====================
async function downloadBatchZipReliable() {
    if (isZipLoading) {
        alert("A download is already in progress.");
        return;
    }
    
    const batchId = document.getElementById('batchSelect').value;
    const batchText = document.getElementById('batchSelect').options[document.getElementById('batchSelect').selectedIndex].text;
    
    if(!batchId) {
        alert("Select a batch first.");
        return;
    }
    
    isZipLoading = true;
    const loader = document.getElementById('loader');
    const barWrap = document.getElementById('zip-progress');
    const bar = document.getElementById('zip-bar');
    
    loader.style.display = 'block';
    barWrap.style.display = 'block';
    bar.style.width = "0%";
    loader.innerHTML = '<div class="spinner"></div><p>Preparing batch download...</p>';
    
    try {
        // Get file list
        const fileList = await fetch(`${API_URL}?action=getFilesInBatch&args=${encodeURIComponent(JSON.stringify([batchId]))}`).then(r => r.json());
        
        if (fileList.length === 0) {
            throw new Error("No files found in this batch.");
        }
        
        const zip = new JSZip();
        const chunkSize = 3; // Smaller chunks for mobile
        let completed = 0;
        
        // Process files in chunks
        for (let i = 0; i < fileList.length; i += chunkSize) {
            const chunk = fileList.slice(i, i + chunkSize);
            await Promise.all(chunk.map(async (file) => {
                try {
                    const fData = await fetch(`${API_URL}?action=getFileBytes&args=${encodeURIComponent(JSON.stringify([file.id]))}`).then(r => r.json());
                    if (fData && fData.bytes) {
                        zip.file(`${file.name}.pdf`, fData.bytes, {base64: true});
                    }
                } catch (error) {
                    console.error(`Failed to fetch ${file.name}:`, error);
                }
                
                completed++;
                const progress = Math.round((completed / fileList.length) * 100);
                bar.style.width = progress + "%";
            }));
        }
        
        loader.innerHTML = '<div class="spinner"></div><p>Creating ZIP file...</p>';
        
        // Generate ZIP
        const zipBlob = await zip.generateAsync({type: "blob"});
        const fileName = `Batch_${batchText.replace(/\s+/g, '_')}.zip`;
        
        // Save the ZIP
        saveBlobAsFile(zipBlob, fileName);
        
        showToast("✅ ZIP created successfully!");
        
    } catch (error) {
        console.error("ZIP creation error:", error);
        alert("Failed to create ZIP: " + error.message);
    } finally {
        isZipLoading = false;
        loader.style.display = 'none';
        barWrap.style.display = 'none';
    }
}

// ==================== UNIVERSAL FILE SAVER ====================
function saveBlobAsFile(blob, fileName) {
    showToast("Saving file...");
    
    // Method 1: Use FileSaver.js (if available)
    if (typeof saveAs !== 'undefined') {
        saveAs(blob, fileName);
        return;
    }
    
    // Method 2: Create download link
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    
    // For iOS Safari, we need to append to body
    if (isIOS()) {
        document.body.appendChild(link);
    }
    
    // Create click event
    if (document.createEvent) {
        const event = document.createEvent('MouseEvents');
        event.initEvent('click', true, true);
        link.dispatchEvent(event);
    } else {
        link.click();
    }
    
    // Clean up
    setTimeout(() => {
        if (link.parentNode) {
            document.body.removeChild(link);
        }
        URL.revokeObjectURL(url);
        
        // Show instructions for mobile
        if (isMobileDevice()) {
            setTimeout(() => {
                showToast("Check your Downloads folder");
                alert("📥 File download started!\n\nIf you don't see it:\n1. Check browser downloads\n2. Look in your device's Downloads folder\n3. Check notifications\n\nFor iOS: Files are usually saved to the 'Files' app.");
            }, 1000);
        }
    }, 1000);
}

// ==================== DEVICE DETECTION ====================
function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function isIOS() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isAndroid() {
    return /Android/i.test(navigator.userAgent);
}

// ==================== HELPER FUNCTIONS ====================
function showToast(msg) {
    const t = document.getElementById('toast');
    t.innerText = msg;
    t.style.display = 'block';
    setTimeout(() => { t.style.display = 'none'; }, 3000);
}

// Close suggestions when clicking outside
window.onclick = (e) => { 
    if (!e.target.closest('.search-container')) {
        document.getElementById('searchSuggestions').style.display = 'none';
    }
    
    // Close modal when clicking outside
    if (e.target.id === 'download-modal') {
        hideDownloadModal();
    }
};

// ==================== ENTER KEY SUPPORT ====================
document.addEventListener('DOMContentLoaded', function() {
    const uidInput = document.getElementById('uid');
    const passInput = document.getElementById('pass');
    
    if (uidInput && passInput) {
        uidInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                passInput.focus();
            }
        });
        
        passInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                handleLogin();
            }
        });
    }
    
    // Also support Enter key in search
    const searchBox = document.getElementById('searchBox');
    if (searchBox) {
        searchBox.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                const firstSuggestion = document.querySelector('.suggestion-item');
                if (firstSuggestion) {
                    firstSuggestion.click();
                }
            }
        });
    }
});

// ==================== OFFLINE SUPPORT ====================
// Cache important data for offline use
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
        navigator.serviceWorker.register('/sw.js').catch(function(error) {
            console.log('ServiceWorker registration failed:', error);
        });
    });
}
