// ตัวแปร global
let currentPage = 1;
let totalPages = 1;
let currentData = [];
let historyData = JSON.parse(localStorage.getItem('apiHistory')) || [];
let filterCount = 0;

// ฟังก์ชันหลักสำหรับดึงข้อมูล
async function fetchData() {
    const apiUrl = document.getElementById('apiUrl').value;
    const token = document.getElementById('apiToken').value;
    const sheetName = document.getElementById('sheetName').value;
    const searchId = document.getElementById('searchId').value;
    const limit = parseInt(document.getElementById('limit').value) || 10;
    const offset = parseInt(document.getElementById('offset').value) || 0;

    // ตรวจสอบข้อมูลที่จำเป็น
    if (!apiUrl) {
        showError('กรุณาใส่ Google Apps Script URL');
        return;
    }

    if (!token) {
        showError('กรุณาใส่ API Token');
        return;
    }

    if (!sheetName) {
        showError('กรุณาเลือก Sheet');
        return;
    }

    // แสดง loading
    showLoading(true);
    hideError();

    // สร้าง payload
    const payload = {
        token: token,
        sheetName: sheetName,
        options: {
            limit: limit,
            offset: offset
        }
    };

    // เพิ่ม ID ถ้ามี
    if (searchId) {
        payload.id = searchId;
    }

    // เพิ่ม filters ถ้ามี
    const filters = getFilters();
    if (Object.keys(filters).length > 0) {
        payload.options.filters = filters;
    }

    // บันทึก start time
    const startTime = Date.now();

    try {
        // ลองใช้ fetch แบบปกติ
        const response = await fetch(apiUrl, {
            method: 'POST',
            mode: 'cors',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        handleSuccessResponse(result, startTime);

    } catch (error) {
        console.log('Fetch failed, trying JSONP...', error);
        
        // ถ้า fetch ล้มเหลว ให้ลองใช้ JSONP
        tryJsonp(payload, startTime);
    }
}

// ฟังก์ชันลองใช้ JSONP
function tryJsonp(payload, startTime) {
    const apiUrl = document.getElementById('apiUrl').value;
    const callbackName = 'jsonpCallback_' + Date.now();

    // สร้างฟังก์ชัน callback
    window[callbackName] = function(response) {
        handleSuccessResponse(response, startTime);
        delete window[callbackName];
        document.body.removeChild(script);
    };

    // สร้าง script tag
    const script = document.createElement('script');
    const dataStr = encodeURIComponent(JSON.stringify(payload));
    script.src = apiUrl + '?callback=' + callbackName + '&data=' + dataStr;

    script.onerror = function() {
        showLoading(false);
        showError('ไม่สามารถเชื่อมต่อกับ API ได้ (JSONP ล้มเหลว)');
        delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
        
        // บันทึกประวัติ
        addToHistory('JSONP Failed', 'error', Date.now() - startTime);
    };

    document.body.appendChild(script);

    // ตั้งเวลา timeout
    setTimeout(() => {
        if (window[callbackName]) {
            showLoading(false);
            showError('การเรียกข้อมูลหมดเวลา');
            delete window[callbackName];
            if (script.parentNode) script.parentNode.removeChild(script);
        }
    }, 30000);
}

// ฟังก์ชันจัดการ response สำเร็จ
function handleSuccessResponse(result, startTime) {
    showLoading(false);
    
    const endTime = Date.now();
    const responseTime = endTime - startTime;

    if (result.success) {
        currentData = result.data || [];
        
        // แสดงสถิติ
        document.getElementById('resultStats').style.display = 'grid';
        document.getElementById('dataCount').textContent = currentData.length;
        document.getElementById('responseTime').textContent = responseTime;
        document.getElementById('dataSize').textContent = 
            (new TextEncoder().encode(JSON.stringify(currentData)).length / 1024).toFixed(2);

        // แสดงข้อมูล
        displayData(currentData);
        
        // จัดการ pagination
        setupPagination(currentData.length);
        
        // บันทึกประวัติ
        addToHistory('Success', 'success', responseTime, currentData.length);
        
    } else {
        showError(result.message || 'เกิดข้อผิดพลาดจาก API');
        addToHistory('Failed: ' + result.message, 'error', responseTime);
    }
}

// ฟังก์ชันดึงค่าตัวกรอง
function getFilters() {
    const filters = {};
    const filterRows = document.querySelectorAll('.filter-row');
    
    filterRows.forEach(row => {
        const key = row.querySelector('.filter-key').value;
        const value = row.querySelector('.filter-value').value;
        if (key && value) {
            filters[key] = value;
        }
    });
    
    return filters;
}

// ฟังก์ชันแสดงข้อมูลในตาราง
function displayData(data) {
    const tableHeader = document.getElementById('tableHeader');
    const tableBody = document.getElementById('tableBody');
    
    if (!data || data.length === 0) {
        tableHeader.innerHTML = '<th>#</th><th>ข้อมูล</th>';
        tableBody.innerHTML = `
            <tr>
                <td colspan="2" class="empty-state">
                    <i class="fas fa-search fa-3x"></i>
                    <p>ไม่พบข้อมูล</p>
                </td>
            </tr>
        `;
        return;
    }

    // สร้าง headers
    const headers = Object.keys(data[0]);
    tableHeader.innerHTML = '<th>#</th>';
    headers.forEach(header => {
        tableHeader.innerHTML += `<th>${header}</th>`;
    });

    // แสดงข้อมูล
    tableBody.innerHTML = '';
    data.forEach((item, index) => {
        let row = '<tr>';
        row += `<td>${index + 1 + (currentPage - 1) * 10}</td>`;
        headers.forEach(header => {
            let value = item[header] || '-';
            if (value && value.length > 50) {
                value = value.substring(0, 50) + '...';
            }
            row += `<td title="${item[header] || ''}">${value}</td>`;
        });
        row += '</tr>';
        tableBody.innerHTML += row;
    });
}

// ฟังก์ชันจัดการ pagination
function setupPagination(totalItems) {
    const itemsPerPage = parseInt(document.getElementById('limit').value) || 10;
    totalPages = Math.ceil(totalItems / itemsPerPage);
    
    if (totalPages > 1) {
        document.getElementById('pagination').style.display = 'flex';
        document.getElementById('pageInfo').textContent = `หน้า ${currentPage} / ${totalPages}`;
        
        document.getElementById('prevBtn').disabled = currentPage === 1;
        document.getElementById('nextBtn').disabled = currentPage === totalPages;
    } else {
        document.getElementById('pagination').style.display = 'none';
    }
}

// ฟังก์ชันเปลี่ยนหน้า
function changePage(direction) {
    if (direction === 'prev' && currentPage > 1) {
        currentPage--;
    } else if (direction === 'next' && currentPage < totalPages) {
        currentPage++;
    } else {
        return;
    }

    const start = (currentPage - 1) * parseInt(document.getElementById('limit').value);
    const end = start + parseInt(document.getElementById('limit').value);
    const pageData = currentData.slice(start, end);
    
    displayData(pageData);
    document.getElementById('pageInfo').textContent = `หน้า ${currentPage} / ${totalPages}`;
    document.getElementById('prevBtn').disabled = currentPage === 1;
    document.getElementById('nextBtn').disabled = currentPage === totalPages;
}

// ฟังก์ชันทดสอบการเชื่อมต่อ
async function testConnection() {
    const apiUrl = document.getElementById('apiUrl').value;
    const token = document.getElementById('apiToken').value;
    const sheetName = document.getElementById('sheetName').value;

    if (!apiUrl || !token || !sheetName) {
        alert('กรุณากรอกข้อมูลให้ครบถ้วน');
        return;
    }

    showLoading(true);
    const startTime = Date.now();

    const testPayload = {
        token: token,
        sheetName: sheetName,
        options: {
            limit: 1
        }
    };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            mode: 'cors',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(testPayload)
        });

        const result = await response.json();
        const endTime = Date.now();
        showLoading(false);

        const statusDiv = document.getElementById('connectionStatus');
        statusDiv.style.display = 'flex';
        
        if (result.success) {
            statusDiv.className = 'connection-status success';
            statusDiv.innerHTML = `
                <i class="fas fa-check-circle"></i>
                <div>
                    <strong>เชื่อมต่อสำเร็จ!</strong><br>
                    เวลาที่ใช้: ${endTime - startTime} ms
                </div>
            `;
        } else {
            statusDiv.className = 'connection-status error';
            statusDiv.innerHTML = `
                <i class="fas fa-exclamation-circle"></i>
                <div>
                    <strong>เชื่อมต่อล้มเหลว!</strong><br>
                    ${result.message || 'ไม่ทราบสาเหตุ'}
                </div>
            `;
        }

        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, 5000);

    } catch (error) {
        showLoading(false);
        const statusDiv = document.getElementById('connectionStatus');
        statusDiv.style.display = 'flex';
        statusDiv.className = 'connection-status error';
        statusDiv.innerHTML = `
            <i class="fas fa-exclamation-circle"></i>
            <div>
                <strong>เชื่อมต่อล้มเหลว!</strong><br>
                ${error.message}
            </div>
        `;
        
        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, 5000);
    }
}

// ฟังก์ชันเพิ่มตัวกรอง
function addFilterField() {
    filterCount++;
    const container = document.getElementById('filtersContainer');
    
    const filterRow = document.createElement
