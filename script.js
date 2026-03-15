// ใช้ IIFE เพื่อป้องกันตัวแปรชนกัน
(function() {
    'use strict';

    // ตัวแปร global ของ module
    let currentPage = 1;
    let totalPages = 1;
    let currentData = [];
    let historyData = [];
    let filterCount = 0;

    // โหลดประวัติจาก localStorage
    try {
        const saved = localStorage.getItem('apiHistory');
        if (saved) {
            historyData = JSON.parse(saved);
        }
    } catch (e) {
        console.log('No history found');
    }

    // ========== ฟังก์ชันหลัก ==========

    window.fetchData = async function() {
        console.log('fetchData called');
        
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
    };

    // ฟังก์ชันลองใช้ JSONP
    function tryJsonp(payload, startTime) {
        const apiUrl = document.getElementById('apiUrl').value;
        const callbackName = 'jsonpCallback_' + Date.now();

        // สร้างฟังก์ชัน callback
        window[callbackName] = function(response) {
            handleSuccessResponse(response, startTime);
            delete window[callbackName];
            if (script && script.parentNode) {
                script.parentNode.removeChild(script);
            }
        };

        // สร้าง script tag
        const script = document.createElement('script');
        const dataStr = encodeURIComponent(JSON.stringify(payload));
        script.src = apiUrl + '?callback=' + callbackName + '&data=' + dataStr;

        script.onerror = function() {
            showLoading(false);
            showError('ไม่สามารถเชื่อมต่อกับ API ได้ (JSONP ล้มเหลว)');
            delete window[callbackName];
            if (script.parentNode) {
                script.parentNode.removeChild(script);
            }
            
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
                if (script.parentNode) {
                    script.parentNode.removeChild(script);
                }
            }
        }, 30000);
    }

    // ฟังก์ชันจัดการ response สำเร็จ
    function handleSuccessResponse(result, startTime) {
        showLoading(false);
        
        const endTime = Date.now();
        const responseTime = endTime - startTime;

        if (result && result.success) {
            currentData = result.data || [];
            
            // แสดงสถิติ
            document.getElementById('resultStats').style.display = 'grid';
            document.getElementById('dataCount').textContent = currentData.length;
            document.getElementById('responseTime').textContent = responseTime;
            
            const dataSize = new TextEncoder().encode(JSON.stringify(currentData)).length / 1024;
            document.getElementById('dataSize').textContent = dataSize.toFixed(2);

            // แสดงข้อมูล
            displayData(currentData);
            
            // จัดการ pagination
            setupPagination(currentData.length);
            
            // บันทึกประวัติ
            addToHistory('Success', 'success', responseTime, currentData.length);
            
        } else {
            showError(result?.message || 'เกิดข้อผิดพลาดจาก API');
            addToHistory('Failed: ' + (result?.message || 'Unknown error'), 'error', responseTime);
        }
    }

    // ฟังก์ชันดึงค่าตัวกรอง
    function getFilters() {
        const filters = {};
        const filterRows = document.querySelectorAll('.filter-row');
        
        filterRows.forEach(row => {
            const key = row.querySelector('.filter-key')?.value;
            const value = row.querySelector('.filter-value')?.value;
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
            tableHeader.innerHTML += `<th>${escapeHtml(header)}</th>`;
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
                row += `<td title="${escapeHtml(item[header] || '')}">${escapeHtml(value)}</td>`;
            });
            row += '</tr>';
            tableBody.innerHTML += row;
        });
    }

    // ฟังก์ชันป้องกัน XSS
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ฟังก์ชันจัดการ pagination
    function setupPagination(totalItems) {
        const itemsPerPage = parseInt(document.getElementById('limit').value) || 10;
        totalPages = Math.ceil(totalItems / itemsPerPage);
        currentPage = 1;
        
        if (totalPages > 1) {
            document.getElementById('pagination').style.display = 'flex';
            document.getElementById('pageInfo').textContent = `หน้า ${currentPage} / ${totalPages}`;
            
            document.getElementById('prevBtn').disabled = true;
            document.getElementById('nextBtn').disabled = currentPage === totalPages;
        } else {
            document.getElementById('pagination').style.display = 'none';
        }
    }

    window.changePage = function(direction) {
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
    };

    window.testConnection = async function() {
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
            
            if (result && result.success) {
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
                        ${result?.message || 'ไม่ทราบสาเหตุ'}
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
    };

    window.addFilterField = function() {
        filterCount++;
        const container = document.getElementById('filtersContainer');
        
        const filterRow = document.createElement('div');
        filterRow.className = 'filter-row';
        filterRow.id = `filter-${filterCount}`;
        
        filterRow.innerHTML = `
            <input type="text" class="filter-key" placeholder="ชื่อคอลัมน์ (เช่น name)">
            <input type="text" class="filter-value" placeholder="ค่าที่ต้องการกรอง">
            <button type="button" onclick="removeFilter(${filterCount})">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        container.appendChild(filterRow);
    };

    window.removeFilter = function(id) {
        const filterRow = document.getElementById(`filter-${id}`);
        if (filterRow) {
            filterRow.remove();
        }
    };

    window.toggleAdvancedFilters = function() {
        const content = document.getElementById('advancedFiltersContent');
        const icon = document.getElementById('toggleIcon');
        
        if (content.style.display === 'none') {
            content.style.display = 'block';
            icon.className = 'fas fa-chevron-up';
        } else {
            content.style.display = 'none';
            icon.className = 'fas fa-chevron-down';
        }
    };

    window.resetFilters = function() {
        document.getElementById('searchId').value = '';
        document.getElementById('limit').value = '10';
        document.getElementById('offset').value = '0';
        document.getElementById('filtersContainer').innerHTML = '';
        filterCount = 0;
        addFilterField(); // เพิ่มตัวกรองเริ่มต้น 1 อัน
        
        document.getElementById('resultStats').style.display = 'none';
        document.getElementById('pagination').style.display = 'none';
        document.getElementById('tableHeader').innerHTML = '<th>#</th><th>ข้อมูล</th>';
        document.getElementById('tableBody').innerHTML = `
            <tr>
                <td colspan="2" class="empty-state">
                    <i class="fas fa-inbox fa-3x"></i>
                    <p>กรุณากดปุ่ม "ดึงข้อมูล" เพื่อแสดงผล</p>
                </td>
            </tr>
        `;
    };

    // ฟังก์ชันแสดง loading
    function showLoading(show) {
        document.getElementById('loading').style.display = show ? 'block' : 'none';
    }

    // ฟังก์ชันแสดง error
    function showError(message) {
        document.getElementById('errorMessage').style.display = 'flex';
        document.getElementById('errorText').textContent = message;
    }

    // ฟังก์ชันซ่อน error
    function hideError() {
        document.getElementById('errorMessage').style.display = 'none';
    }

    // ฟังก์ชันเพิ่มประวัติ
    function addToHistory(message, status, responseTime, dataCount = 0) {
        const history = {
            time: new Date().toLocaleTimeString(),
            date: new Date().toLocaleDateString(),
            message: message,
            status: status,
            responseTime: responseTime,
            dataCount: dataCount
        };
        
        historyData.unshift(history);
        
        // เก็บเฉพาะ 20 รายการล่าสุด
        if (historyData.length > 20) {
            historyData.pop();
        }
        
        try {
            localStorage.setItem('apiHistory', JSON.stringify(historyData));
        } catch (e) {
            console.log('Failed to save history');
        }
        
        displayHistory();
    }

    // ฟังก์ชันแสดงประวัติ
    function displayHistory() {
        const historyList = document.getElementById('historyList');
        
        if (historyData.length === 0) {
            historyList.innerHTML = '<div class="empty-state" style="padding: 20px;">ไม่มีประวัติ</div>';
            return;
        }
        
        historyList.innerHTML = '';
        historyData.slice(0, 10).forEach(item => {
            const historyItem = document.createElement('div');
            historyItem.className = 'history-item';
            historyItem.innerHTML = `
                <div>
                    <span class="time">${item.time}</span>
                    <span style="margin-left: 10px;">${escapeHtml(item.message)}</span>
                    ${item.dataCount ? `<small>(${item.dataCount} รายการ)</small>` : ''}
                </div>
                <span class="status ${item.status}">
                    ${item.responseTime}ms
                </span>
            `;
            historyList.appendChild(historyItem);
        });
    }

    window.clearHistory = function() {
        if (confirm('ต้องการล้างประวัติทั้งหมด?')) {
            historyData = [];
            localStorage.removeItem('apiHistory');
            displayHistory();
        }
    };

    window.showHowTo = function() {
        document.getElementById('howToModal').style.display = 'block';
    };

    window.closeModal = function() {
        document.getElementById('howToModal').style.display = 'none';
    };

    window.exportToCSV = function() {
        if (!currentData || currentData.length === 0) {
            alert('ไม่มีข้อมูลให้ export');
            return;
        }

        const headers = Object.keys(currentData[0]);
        const csvContent = [
            headers.join(','),
            ...currentData.map(row => headers.map(header => `"${row[header] || ''}"`).join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        
        link.setAttribute('href', url);
        link.setAttribute('download', `google-sheets-data-${new Date().toISOString().slice(0,10)}.csv`);
        link.style.visibility = 'hidden';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    window.exportToJSON = function() {
        if (!currentData || currentData.length === 0) {
            alert('ไม่มีข้อมูลให้ export');
            return;
        }

        const jsonContent = JSON.stringify(currentData, null, 2);
        const blob = new Blob([jsonContent], { type: 'application/json' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        
        link.setAttribute('href', url);
        link.setAttribute('download', `google-sheets-data-${new Date().toISOString().slice(0,10)}.json`);
        link.style.visibility = 'hidden';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    window.refreshData = function() {
        if (currentData.length > 0) {
            fetchData();
        }
    };

    window.copyData = function() {
        if (!currentData || currentData.length === 0) {
            alert('ไม่มีข้อมูลให้คัดลอก');
            return;
        }

        const jsonString = JSON.stringify(currentData, null, 2);
        navigator.clipboard.writeText(jsonString).then(() => {
            alert('คัดลอกข้อมูลแล้ว');
        }).catch(() => {
            alert('ไม่สามารถคัดลอกข้อมูลได้');
        });
    };

    // เริ่มต้นเมื่อโหลดหน้า
    document.addEventListener('DOMContentLoaded', function() {
        console.log('DOM loaded, initializing...');
        
        // เพิ่มตัวกรองเริ่มต้น
        if (document.getElementById('filtersContainer').children.length === 0) {
            addFilterField();
        }
        
        // แสดงประวัติ
        displayHistory();
        
        // ตรวจสอบว่า fetchData ถูกประกาศหรือไม่
        if (typeof window.fetchData === 'function') {
            console.log('fetchData is ready');
        } else {
            console.error('fetchData is not defined');
        }
    });

})(); // ปิด IIFE
