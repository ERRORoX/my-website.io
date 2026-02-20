(function () {
    const API_BASE = '';
    const TOKEN_KEY = 'admin_token';
    const USERNAME_KEY = 'admin_username';

    function getToken() {
        return localStorage.getItem(TOKEN_KEY) || '';
    }

    function setToken(t) {
        localStorage.setItem(TOKEN_KEY, t);
    }

    function getUsername() {
        return localStorage.getItem(USERNAME_KEY) || '';
    }

    function setUsername(u) {
        localStorage.setItem(USERNAME_KEY, u || '');
    }

    function logout() {
        setToken('');
        setUsername('');
        refreshPromise = null;
        logoutForbidden = false;
        document.getElementById('loginScreen').style.display = 'flex';
        document.getElementById('appPanel').style.display = 'none';
        // Сбрасываем данные уведомлений
        notificationsData = { newOrders: 0, lowStock: 0, outOfStock: 0, total: 0 };
        updateNotificationsButton();
    }

    function headers(omitContentType) {
        const h = omitContentType ? {} : { 'Content-Type': 'application/json' };
        const t = getToken();
        if (t) {
            h['X-Admin-Token'] = t;
        } else {
            console.warn('Токен не найден в localStorage при формировании заголовков');
        }
        return h;
    }

    function setLastUpdated() {
        var el = document.getElementById('lastUpdated');
        if (el) el.textContent = 'Обновлено: ' + new Date().toLocaleTimeString('ru-RU');
    }

    var refreshPromise = null;
    var logoutForbidden = false;

    async function tryRefreshToken() {
        var t = getToken();
        if (!t) return null;
        if (refreshPromise) return refreshPromise;
        refreshPromise = (async function () {
            try {
                var res = await fetch(API_BASE + '/api/auth/refresh', {
                    method: 'POST',
                    headers: { 'X-Admin-Token': t }
                });
                if (res.ok) {
                    var data = await res.json();
                    if (data.token) {
                        setToken(data.token);
                        if (data.username) setUsername(data.username);
                        return data.token;
                    }
                }
            } catch (_) {}
            return null;
        })();
        var result = await refreshPromise;
        refreshPromise = null;
        return result;
    }

    async function api(path, options = {}) {
        var url = API_BASE + path;
        var reqHeaders = { ...headers(), ...(options.headers || {}) };
        var token = getToken();
        if (token) {
            reqHeaders['X-Admin-Token'] = token;
        }
        var res = await fetch(url, {
            ...options,
            headers: reqHeaders,
        });
        if (res.status === 401) {
            logout();
            throw new Error('Unauthorized');
        }
        if (res.status === 403) {
            console.log('Получен 403, пытаемся обновить токен. Текущий токен:', token ? token.substring(0, 20) + '...' : 'отсутствует');
            var newToken = await tryRefreshToken();
            if (newToken) {
                console.log('Токен обновлен, повторяем запрос');
                var retryHeaders = { ...headers(), ...(options.headers || {}) };
                retryHeaders['X-Admin-Token'] = newToken;
                var retryRes = await fetch(url, {
                    ...options,
                    headers: retryHeaders,
                });
                if (retryRes.status === 401 || retryRes.status === 403) {
                    if (!logoutForbidden) {
                        logoutForbidden = true;
                        notify('Доступ запрещён. Войдите снова.', 'error');
                        logout();
                    }
                    throw new Error('Forbidden');
                }
                if (retryRes.redirected && retryRes.url) return retryRes.url;
                var text = await retryRes.text();
                if (!retryRes.ok) {
                    var msg = text;
                    try { var j = JSON.parse(text); if (j.error) msg = j.error; } catch (_) {}
                    throw new Error(msg);
                }
                try { return JSON.parse(text); } catch (_) { return text; }
            }
            if (!logoutForbidden) {
                logoutForbidden = true;
                var errorText = await res.text().catch(function() { return ''; });
                console.error('Ошибка 403:', errorText);
                notify('Сессия истекла или доступ запрещён. Войдите снова.', 'error');
                logout();
            }
            throw new Error('Forbidden');
        }
        if (res.redirected && res.url) return res.url;
        var text = await res.text();
        if (!res.ok) {
            var msg = text;
            try {
                var j = JSON.parse(text);
                if (j.error) msg = j.error;
            } catch (_) {}
            throw new Error(msg);
        }
        try {
            return JSON.parse(text);
        } catch (_) {
            return text;
        }
    }

    function notify(message, type) {
        const n = document.createElement('div');
        n.className = 'notification ' + (type || 'info');
        n.innerHTML = '<span>' + message + '</span>';
        n.style.cssText = 'position:fixed;top:20px;right:20px;padding:12px 20px;border-radius:8px;z-index:9999;font-weight:700;';
        if (type === 'error') n.style.background = 'rgba(255,0,102,0.9)';
        else if (type === 'success') n.style.background = 'rgba(0,255,136,0.9)';
        else n.style.background = 'rgba(0,255,136,0.7)';
        n.style.color = '#000';
        document.body.appendChild(n);
        setTimeout(function () { n.remove(); }, 4000);
    }

    // ——— Дашборд ———
    var lastKnownNewOrdersCount = 0;
    var lastKnownLowStockCount = 0;
    var lastKnownOutOfStockCount = 0;
    
    async function loadStats() {
        try {
            const data = await api('/api/stats');
            const set = function (id, val) { const el = document.getElementById(id); if (el) el.textContent = val ?? '—'; };
            set('statOrders', data.orders_total);
            set('statProducts', data.products_total);
            const newOrdersCount = (data.orders_by_status && data.orders_by_status.new) || 0;
            const lowStockCount = data.low_stock_count || 0;
            const outOfStockCount = data.out_of_stock_count || 0;
            
            set('statNew', newOrdersCount);
            set('statOrdersToday', data.orders_today);
            set('statShipped', (data.orders_by_status && data.orders_by_status.shipped) || 0);
            set('statLowStock', lowStockCount);
            set('statOutOfStock', outOfStockCount);
            
            // Обновляем данные уведомлений
            notificationsData.newOrders = newOrdersCount;
            notificationsData.lowStock = lowStockCount;
            notificationsData.outOfStock = outOfStockCount;
            notificationsData.total = newOrdersCount + lowStockCount + outOfStockCount;
            
            // Обновляем кнопку уведомлений
            updateNotificationsButton();
            
            // Проверяем новые заказы для уведомления
            if (lastKnownNewOrdersCount > 0 && newOrdersCount > lastKnownNewOrdersCount) {
                const diff = newOrdersCount - lastKnownNewOrdersCount;
                notify('🆕 Новый заказ! Всего новых заказов: ' + newOrdersCount, 'success');
            }
            
            // Проверяем низкий остаток
            if (lastKnownLowStockCount > 0 && lowStockCount > lastKnownLowStockCount) {
                notify('⚠️ Товары с низким остатком: ' + lowStockCount, 'error');
            }
            
            // Проверяем отсутствие товаров
            if (lastKnownOutOfStockCount > 0 && outOfStockCount > lastKnownOutOfStockCount) {
                notify('📦 Товары закончились: ' + outOfStockCount, 'error');
            }
            
            lastKnownNewOrdersCount = newOrdersCount;
            lastKnownLowStockCount = lowStockCount;
            lastKnownOutOfStockCount = outOfStockCount;
        } catch (e) {
            if (e.message === 'Forbidden') return;
            notify('Ошибка загрузки статистики: ' + e.message, 'error');
        }
        setLastUpdated();
    }

    // ——— Кнопка уведомлений ———
    var notificationsData = {
        newOrders: 0,
        lowStock: 0,
        outOfStock: 0,
        total: 0
    };
    
    function updateNotificationsButton() {
        const btn = document.getElementById('notificationsButton');
        const countEl = document.getElementById('notificationsCount');
        if (!btn || !countEl) return;
        
        const total = notificationsData.total;
        
        if (total > 0) {
            countEl.textContent = total > 99 ? '99+' : total.toString();
            countEl.style.display = 'flex';
            btn.classList.add('has-notifications');
            btn.title = 'Уведомления (' + total + ')';
        } else {
            countEl.style.display = 'none';
            btn.classList.remove('has-notifications');
            btn.title = 'Уведомлений нет';
        }
        
        // Обновляем выпадающее меню
        updateNotificationsDropdown();
    }
    
    function updateNotificationsDropdown() {
        const list = document.getElementById('notificationsList');
        if (!list) return;
        
        const items = [];
        
        if (notificationsData.newOrders > 0) {
            items.push({
                type: 'new-orders',
                icon: '🆕',
                title: 'Новые заказы',
                description: notificationsData.newOrders === 1 
                    ? '1 новый заказ требует внимания'
                    : notificationsData.newOrders + ' новых заказов требуют внимания',
                count: notificationsData.newOrders,
                action: function() {
                    var statusEl = document.getElementById('filterOrderStatus');
                    if (statusEl) statusEl.value = 'new';
                    switchToTab('orders');
                    closeNotificationsDropdown();
                }
            });
        }
        
        if (notificationsData.lowStock > 0) {
            items.push({
                type: 'low-stock',
                icon: '⚠️',
                title: 'Низкий остаток товаров',
                description: notificationsData.lowStock === 1
                    ? '1 товар с остатком ≤ 2 шт.'
                    : notificationsData.lowStock + ' товаров с остатком ≤ 2 шт.',
                count: notificationsData.lowStock,
                action: function() {
                    var stockEl = document.getElementById('filterProductStock');
                    if (stockEl) stockEl.value = 'low';
                    switchToTab('products');
                    closeNotificationsDropdown();
                }
            });
        }
        
        if (notificationsData.outOfStock > 0) {
            items.push({
                type: 'out-of-stock',
                icon: '📦',
                title: 'Товары закончились',
                description: notificationsData.outOfStock === 1
                    ? '1 товар отсутствует в наличии'
                    : notificationsData.outOfStock + ' товаров отсутствуют в наличии',
                count: notificationsData.outOfStock,
                action: function() {
                    var stockEl = document.getElementById('filterProductStock');
                    if (stockEl) stockEl.value = 'out';
                    switchToTab('products');
                    closeNotificationsDropdown();
                }
            });
        }
        
        if (items.length === 0) {
            list.innerHTML = '<div class="notification-item-empty">Нет уведомлений</div>';
        } else {
            list.innerHTML = items.map(function(item) {
                return '<div class="notification-item ' + item.type + '" data-action="' + item.type + '">' +
                    '<span class="notification-icon">' + item.icon + '</span>' +
                    '<div class="notification-content">' +
                    '<div class="notification-title">' + item.title + ' <strong>(' + item.count + ')</strong></div>' +
                    '<div class="notification-description">' + item.description + '</div>' +
                    '</div>' +
                    '</div>';
            }).join('');
            
            // Добавляем обработчики кликов
            list.querySelectorAll('.notification-item').forEach(function(el, index) {
                el.addEventListener('click', items[index].action);
            });
        }
    }
    
    function toggleNotificationsDropdown() {
        const dropdown = document.getElementById('notificationsDropdown');
        const overlay = document.getElementById('notificationsOverlay');
        if (!dropdown) return;
        
        if (dropdown.style.display === 'none' || !dropdown.style.display) {
            dropdown.style.display = 'flex';
            if (overlay) overlay.classList.add('active');
        } else {
            closeNotificationsDropdown();
        }
    }
    
    function closeNotificationsDropdown() {
        const dropdown = document.getElementById('notificationsDropdown');
        const overlay = document.getElementById('notificationsOverlay');
        if (dropdown) dropdown.style.display = 'none';
        if (overlay) overlay.classList.remove('active');
    }

    // ——— Заказы ———
    var lastKnownOrdersCount = 0;
    function getOrdersApiPath(forCompleted) {
        const params = new URLSearchParams();
        if (forCompleted) {
            params.set('status', 'shipped');
            params.set('sort', 'desc');
        } else {
            params.set('exclude_status', 'shipped');
            const statusEl = document.getElementById('filterOrderStatus');
            const searchEl = document.getElementById('searchOrders');
            const sortEl = document.getElementById('sortOrders');
            const periodEl = document.getElementById('filterOrderPeriod');
            if (statusEl && statusEl.value) params.set('status', statusEl.value);
            if (searchEl && searchEl.value.trim()) params.set('search', searchEl.value.trim());
            if (sortEl && sortEl.value) params.set('sort', sortEl.value);
            if (periodEl && periodEl.value) params.set('period', periodEl.value);
        }
        const q = params.toString();
        return '/api/orders' + (q ? '?' + q : '');
    }

    async function loadOrders() {
        const tbody = document.getElementById('ordersTableBody');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="9">Обновление…</td></tr>';
        try {
            const list = await api(getOrdersApiPath());
            if (!list || !list.length) {
                tbody.innerHTML = '<tr><td colspan="9">Нет заказов</td></tr>';
                lastKnownOrdersCount = 0;
                return;
            }
            
            // Проверяем новые заказы для уведомления (только если не первый запуск)
            if (lastKnownOrdersCount > 0 && list.length > lastKnownOrdersCount) {
                const diff = list.length - lastKnownOrdersCount;
                notify('🆕 Появилось новых заказов: ' + diff, 'success');
            }
            lastKnownOrdersCount = list.length;
            tbody.innerHTML = list.map(function (o) {
                const statusOpts = ['new','awaiting_payment','receipt_received','paid'].map(function (s) {
                    const lab = { new: 'Новый', awaiting_payment: 'Ожидает оплату', receipt_received: 'Чек получен', paid: 'Оплачен' }[s] || s;
                    return '<option value="' + s + '"' + (o.status === s ? ' selected' : '') + '>' + lab + '</option>';
                }).join('');
                const receiptBtn = o.receipt_file_id
                    ? '<button class="action-btn view" data-order-id="' + o.id + '" data-receipt>📷 Чек</button>'
                    : '—';
                const isShipped = o.status === 'shipped';
                const isPaid = o.status === 'paid';
                const deleteBtn = isShipped
                    ? '<button class="action-btn ban delete-order" data-order-id="' + o.id + '" title="Убрать из списка">🗑 Удалить</button>'
                    : '';
                const completeBtn = isPaid
                    ? ' <button class="action-btn complete-order" data-order-id="' + o.id + '" title="Отметить как отправленный">✅ Завершить</button>'
                    : '';
                const address = (o.address || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                return '<tr data-order-id="' + o.id + '">' +
                    '<td>' + (o.order_number || '') + '</td>' +
                    '<td>' + (o.full_name || '') + '</td>' +
                    '<td>' + (o.phone || '') + '</td>' +
                    '<td>' + (o.city || '') + '</td>' +
                    '<td class="cell-address" title="' + address + '">' + address + '</td>' +
                    '<td>' + (o.product_title || '') + ' (' + (o.product_price || 0) + ' сом.)</td>' +
                    '<td><select class="order-status-select" data-order-id="' + o.id + '" data-prev="' + (o.status || '') + '">' + statusOpts + '</select></td>' +
                    '<td>' + receiptBtn + '</td>' +
                    '<td>' + deleteBtn + completeBtn + '</td></tr>';
            }).join('');
            bindOrderEvents();
        } catch (e) {
            tbody.innerHTML = '<tr><td colspan="9">Ошибка: ' + e.message + '</td></tr>';
            notify('Ошибка загрузки заказов: ' + e.message, 'error');
        }
        setLastUpdated();
    }

    async function loadCompletedOrders() {
        var tbody = document.getElementById('completedOrdersTableBody');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="8">Обновление…</td></tr>';
        try {
            var list = await api(getOrdersApiPath(true));
            if (!list || !list.length) {
                tbody.innerHTML = '<tr><td colspan="8">Нет завершённых заказов</td></tr>';
                setLastUpdated();
                return;
            }
            tbody.innerHTML = list.map(function (o) {
                var receiptBtn = o.receipt_file_id
                    ? '<button class="action-btn view" data-order-id="' + o.id + '" data-receipt>📷 Чек</button>'
                    : '—';
                var address = (o.address || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                return '<tr data-order-id="' + o.id + '">' +
                    '<td>' + (o.order_number || '') + '</td>' +
                    '<td>' + (o.full_name || '') + '</td>' +
                    '<td>' + (o.phone || '') + '</td>' +
                    '<td>' + (o.city || '') + '</td>' +
                    '<td class="cell-address" title="' + address + '">' + address + '</td>' +
                    '<td>' + (o.product_title || '') + ' (' + (o.product_price || 0) + ' сом.)</td>' +
                    '<td>' + receiptBtn + '</td>' +
                    '<td><button class="action-btn ban delete-order" data-order-id="' + o.id + '">🗑 Удалить</button></td></tr>';
            }).join('');
            document.querySelectorAll('#completedOrdersTableBody .delete-order').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    deleteOrder(this.getAttribute('data-order-id'));
                    loadCompletedOrders();
                });
            });
            document.querySelectorAll('#completedOrdersTableBody [data-receipt]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var id = btn.getAttribute('data-order-id');
                    var url = API_BASE + '/api/orders/' + id + '/receipt';
                    var t = getToken();
                    if (t) url += '?token=' + encodeURIComponent(t);
                    var modal = document.getElementById('modalReceipt');
                    var img = document.getElementById('receiptImage');
                    var link = document.getElementById('receiptLink');
                    if (link) link.href = url;
                    if (img) { img.src = url; img.onerror = function () { img.alt = 'Не удалось загрузить'; }; }
                    if (modal) modal.classList.add('active');
                });
            });
        } catch (e) {
            tbody.innerHTML = '<tr><td colspan="8">Ошибка: ' + e.message + '</td></tr>';
            notify('Ошибка загрузки: ' + e.message, 'error');
        }
        setLastUpdated();
    }

    async function exportOrdersCsv() {
        const statusEl = document.getElementById('filterOrderStatus');
        const searchEl = document.getElementById('searchOrders');
        const sortEl = document.getElementById('sortOrders');
        const params = new URLSearchParams();
        params.set('exclude_status', 'shipped');
        const periodEl = document.getElementById('filterOrderPeriod');
        if (statusEl && statusEl.value) params.set('status', statusEl.value);
        if (searchEl && searchEl.value.trim()) params.set('search', searchEl.value.trim());
        if (sortEl && sortEl.value) params.set('sort', sortEl.value);
        if (periodEl && periodEl.value) params.set('period', periodEl.value);
        const t = getToken();
        if (t) params.set('token', t);
        const url = API_BASE + '/api/orders/export' + (params.toString() ? '?' + params.toString() : '');
        try {
            const res = await fetch(url, { headers: t ? { 'X-Admin-Token': t } : {} });
            if (res.status === 403) {
                notify('Введите секретный ключ в настройках', 'error');
                return;
            }
            if (!res.ok) throw new Error(await res.text());
            const blob = await res.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'orders.csv';
            a.click();
            URL.revokeObjectURL(a.href);
            notify('Файл orders.csv сохранён', 'success');
        } catch (e) {
            notify('Ошибка экспорта: ' + e.message, 'error');
        }
    }

    function deleteOrder(id) {
        if (!confirm('Убрать этот заказ из списка? (Заказ со статусом «Отправлен» будет удалён.)')) return;
        api('/api/orders/' + id, { method: 'DELETE' })
            .then(function () {
                notify('Заказ удалён', 'success');
                loadOrders();
                loadStats();
            })
            .catch(function (e) { notify(e.message || 'Ошибка удаления', 'error'); });
    }

    function bindOrderEvents() {
        document.querySelectorAll('.order-status-select').forEach(function (sel) {
            sel.addEventListener('change', function () {
                const id = this.getAttribute('data-order-id');
                const status = this.value;
                const needConfirm = (status === 'paid' || status === 'shipped');
                function doPatch() {
                    api('/api/orders/' + id + '/status', { method: 'PATCH', body: JSON.stringify({ status: status }) })
                        .then(function () { notify('Статус обновлён', 'success'); loadOrders(); loadCompletedOrders(); loadStats(); })
                        .catch(function (e) { notify('Ошибка: ' + e.message, 'error'); });
                }
                if (needConfirm && !confirm('Клиент получит уведомление в Telegram. Продолжить?')) {
                    sel.value = sel.getAttribute('data-prev') || sel.value;
                    return;
                }
                sel.setAttribute('data-prev', status);
                doPatch();
            });
        });
        document.querySelectorAll('.delete-order').forEach(function (btn) {
            btn.addEventListener('click', function () { deleteOrder(this.getAttribute('data-order-id')); });
        });
        document.querySelectorAll('.complete-order').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = this.getAttribute('data-order-id');
                if (!confirm('Клиент получит уведомление об отправке. Продолжить?')) return;
                api('/api/orders/' + id + '/status', { method: 'PATCH', body: JSON.stringify({ status: 'shipped' }) })
                    .then(function () {
                        notify('Заказ отмечен как завершённый', 'success');
                        loadOrders();
                        loadCompletedOrders();
                        loadStats();
                    })
                    .catch(function (e) { notify('Ошибка: ' + e.message, 'error'); });
            });
        });
        document.querySelectorAll('[data-receipt]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const id = this.getAttribute('data-order-id');
                var url = API_BASE + '/api/orders/' + id + '/receipt';
                var t = getToken();
                if (t) url += '?token=' + encodeURIComponent(t);
                const modal = document.getElementById('modalReceipt');
                const img = document.getElementById('receiptImage');
                const link = document.getElementById('receiptLink');
                if (link) link.href = url;
                if (img) { img.src = url; img.onerror = function () { img.alt = 'Не удалось загрузить'; }; }
                if (modal) modal.classList.add('active');
            });
        });
    }
    
    // ——— Товары ———
    function getProductsApiPath() {
        const stockEl = document.getElementById('filterProductStock');
        const v = stockEl && stockEl.value ? '?stock_filter=' + encodeURIComponent(stockEl.value) : '';
        return '/api/products' + v;
    }

    var productsViewMode = localStorage.getItem('productsViewMode') || 'table';

    function renderProductsTable(list) {
        const tbody = document.getElementById('productsTableBody');
        if (!tbody) return;
        if (!list || !list.length) {
            tbody.innerHTML = '<tr><td colspan="6">Нет товаров</td></tr>';
            return;
        }
        tbody.innerHTML = list.map(function (p) {
            var stock = p.stock != null ? p.stock : 0;
            return '<tr>' +
                '<td>' + p.id + '</td>' +
                '<td>' + (p.title || '') + '</td>' +
                '<td>' + (p.category_label || p.category || '') + '</td>' +
                '<td>' + (p.price || 0) + '</td>' +
                '<td>' + stock + '</td>' +
                '<td>' +
                '<button class="action-btn edit-product" data-id="' + p.id + '">✏️</button> ' +
                '<button class="action-btn ban delete-product" data-id="' + p.id + '">🗑️</button>' +
                '</td></tr>';
        }).join('');
        bindProductEvents();
    }

    function renderProductsGrid(list) {
        const gridView = document.getElementById('productsGridView');
        if (!gridView) return;
        if (!list || !list.length) {
            gridView.innerHTML = '<div class="product-card" style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px;">Нет товаров</div>';
            return;
        }
        gridView.innerHTML = list.map(function (p) {
            var stock = p.stock != null ? p.stock : 0;
            var stockClass = stock === 0 ? 'out' : (stock <= 2 ? 'low' : '');
            var stockText = stock === 0 ? 'Нет в наличии' : (stock <= 2 ? 'Остаток: ' + stock + ' шт.' : 'В наличии: ' + stock + ' шт.');
            var t = getToken();
            var imageUrl = p.image_file_id ? (API_BASE + '/api/products/' + p.id + '/image' + (t ? '?token=' + encodeURIComponent(t) : '')) : '';
            var imgHtml = imageUrl ? '<img src="' + imageUrl + '" class="product-card-image" alt="' + (p.title || '').replace(/"/g, '&quot;') + '" loading="lazy" onerror="this.style.display=\'none\'; var pl=this.nextElementSibling; if(pl) pl.classList.remove(\'product-card-image-placeholder-hidden\');">' : '';
            var placeholderClass = 'product-card-image product-card-image-placeholder' + (imageUrl ? ' product-card-image-placeholder-hidden' : '');
            var placeholderHtml = '<div class="' + placeholderClass + '">📦</div>';
            var description = (p.description || '').trim();
            var descriptionHtml = description ? '<div class="product-card-description">' + description + '</div>' : '<div class="product-card-description" style="min-height: 0; margin-bottom: 0;"></div>';
            return '<div class="product-card">' +
                (imageUrl ? imgHtml : '') + placeholderHtml +
                '<div class="product-card-title">' + (p.title || '') + '</div>' +
                '<div class="product-card-category">' + (p.category_label || p.category || '') + '</div>' +
                descriptionHtml +
                '<div class="product-card-price">' + (p.price || 0) + ' сом.</div>' +
                '<div class="product-card-stock ' + stockClass + '">' + stockText + '</div>' +
                '<div class="product-card-actions">' +
                '<button type="button" class="action-btn edit-product" data-id="' + p.id + '">✏️ Редактировать</button>' +
                '<button type="button" class="action-btn ban delete-product" data-id="' + p.id + '">🗑️ Удалить</button>' +
                '</div></div>';
        }).join('');
        bindProductEvents();
    }

    async function loadProducts() {
        const tbody = document.getElementById('productsTableBody');
        const gridView = document.getElementById('productsGridView');
        if (tbody) tbody.innerHTML = '<tr><td colspan="6">Обновление…</td></tr>';
        if (gridView) gridView.innerHTML = '<div class="product-card" style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px;">Обновление…</div>';
        try {
            const list = await api(getProductsApiPath());
            if (productsViewMode === 'grid') {
                renderProductsGrid(list);
            } else {
                renderProductsTable(list);
            }
        } catch (e) {
            if (tbody) tbody.innerHTML = '<tr><td colspan="6">Ошибка: ' + e.message + '</td></tr>';
            if (gridView) gridView.innerHTML = '<div class="product-card" style="grid-column: 1/-1; text-align: center; color: var(--danger); padding: 40px;">Ошибка: ' + e.message + '</div>';
            notify('Ошибка загрузки товаров: ' + e.message, 'error');
        }
        setLastUpdated();
    }

    function toggleProductsView() {
        productsViewMode = productsViewMode === 'table' ? 'grid' : 'table';
        localStorage.setItem('productsViewMode', productsViewMode);
        var tableView = document.getElementById('productsTableView');
        var gridView = document.getElementById('productsGridView');
        var toggleBtn = document.getElementById('productsViewToggle');
        if (!tableView || !gridView || !toggleBtn) {
            notify('Ошибка: элементы не найдены', 'error');
            return;
        }
        if (productsViewMode === 'grid') {
            tableView.style.display = 'none';
            gridView.style.display = 'grid';
            toggleBtn.textContent = '📋 Список';
        } else {
            tableView.style.display = 'block';
            gridView.style.display = 'none';
            toggleBtn.textContent = '🔲 Плитки';
        }
        loadProducts();
    }

    function openProductModal(id) {
        const modal = document.getElementById('modalProduct');
        const titleEl = document.getElementById('modalProductTitle');
        document.getElementById('productId').value = id || '';
        document.getElementById('productTitle').value = '';
        document.getElementById('productDescription').value = '';
        document.getElementById('productPrice').value = '';
        document.getElementById('productCategory').value = 'work';
        var stockEl = document.getElementById('productStock');
        if (stockEl) stockEl.value = '0';
        var imgInp = document.getElementById('productImage');
        var vidInp = document.getElementById('productVideo');
        if (imgInp) imgInp.value = '';
        if (vidInp) vidInp.value = '';
        if (id) {
            titleEl.textContent = 'Редактировать товар';
            api('/api/products/' + id).then(function (p) {
                document.getElementById('productTitle').value = p.title || '';
                document.getElementById('productDescription').value = p.description || '';
                document.getElementById('productPrice').value = p.price || '';
                document.getElementById('productCategory').value = p.category || 'work';
                if (stockEl) stockEl.value = (p.stock != null ? p.stock : 0);
            }).catch(function (e) { notify(e.message, 'error'); });
        } else {
            titleEl.textContent = 'Добавить товар';
        }
        modal.classList.add('active');
    }

    function formatBytes(bytes) {
        if (bytes === 0) return '0 Б';
        var k = 1024;
        var sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
        var i = Math.floor(Math.log(bytes) / Math.log(k));
        var v = bytes / Math.pow(k, i);
        return (i === 0 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, '')) + ' ' + sizes[i];
    }

    function shortFileName(name, maxLen) {
        maxLen = maxLen || 42;
        if (!name || name.length <= maxLen) return name;
        var ext = '';
        var lastDot = name.lastIndexOf('.');
        if (lastDot > 0 && lastDot > name.length - 6) {
            ext = name.slice(lastDot);
            name = name.slice(0, lastDot);
        }
        var keep = maxLen - ext.length - 1;
        if (keep < 8) return name.slice(0, maxLen - 1) + '…';
        return name.slice(0, keep) + '…' + ext;
    }

    var uploadState = {
        active: false,
        realLoaded: 0,
        realTotal: 0,
        realPercent: 0,
        realSpeedStr: '—',
        displayedLoaded: 0,
        displayedPercent: 0,
        label: '',
        total: 0,
        indeterminate: false
    };
    var uploadProgressRafId = null;

    function showUploadProgress(show, percent, label, detail) {
        var wrap = document.getElementById('uploadProgressWrap');
        var fill = document.getElementById('uploadProgressFill');
        var lbl = document.getElementById('uploadProgressLabel');
        var detailEl = document.getElementById('uploadProgressDetail');
        var iconEl = document.getElementById('uploadProgressIcon');
        if (wrap) {
            wrap.style.display = show ? 'block' : 'none';
            if (show) wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        if (fill && percent != null) {
            fill.classList.remove('indeterminate');
        } else if (fill) {
            fill.style.width = '40%';
            fill.classList.add('indeterminate');
        }
        if (lbl && label != null) lbl.textContent = label;
        if (detailEl) {
            detailEl.textContent = detail != null ? detail : '';
            detailEl.style.display = detail ? 'block' : 'none';
        }
        if (iconEl) {
            iconEl.className = 'upload-progress-icon' + (percent === 100 ? ' done' : ' uploading');
            iconEl.textContent = percent === 100 ? '✓' : '⏳';
        }
    }

    function animateUploadProgress() {
        var fill = document.getElementById('uploadProgressFill');
        var detailEl = document.getElementById('uploadProgressDetail');
        var s = uploadState;
        if (!s.active || !fill) {
            uploadProgressRafId = null;
            return;
        }
        if (s.indeterminate) {
            uploadProgressRafId = requestAnimationFrame(animateUploadProgress);
            return;
        }
        var step = 0.08;
        s.displayedLoaded += (s.realLoaded - s.displayedLoaded) * step;
        s.displayedPercent += (s.realPercent - s.displayedPercent) * step;
        if (s.displayedPercent > 99.5) s.displayedPercent = s.realPercent;
        if (s.displayedLoaded > s.realTotal - 100) s.displayedLoaded = s.realLoaded;
        var pctShow = Math.min(99.9, Math.round(s.displayedPercent * 10) / 10);
        var loadedShow = Math.round(s.displayedLoaded);
        fill.style.width = pctShow + '%';
        if (detailEl) {
            detailEl.textContent = formatBytes(loadedShow) + ' из ' + formatBytes(s.realTotal) + ' (' + pctShow + '%) · ' + s.realSpeedStr;
        }
        if (s.displayedPercent >= 99.5 && s.realPercent >= 99.5) {
            uploadProgressRafId = null;
            return;
        }
        uploadProgressRafId = requestAnimationFrame(animateUploadProgress);
    }

    // Функция сжатия изображения на клиенте
    function compressImage(file, maxWidth, maxHeight, quality, callback) {
        if (!file.type || !file.type.startsWith('image/')) {
            callback(file);
            return;
        }
        
        var reader = new FileReader();
        reader.onload = function(e) {
            var img = new Image();
            img.onload = function() {
                var canvas = document.createElement('canvas');
                var ctx = canvas.getContext('2d');
                
                // Вычисляем новые размеры с сохранением пропорций
                var width = img.width;
                var height = img.height;
                if (width > maxWidth || height > maxHeight) {
                    if (width > height) {
                        height = (height * maxWidth) / width;
                        width = maxWidth;
                    } else {
                        width = (width * maxHeight) / height;
                        height = maxHeight;
                    }
                }
                
                canvas.width = width;
                canvas.height = height;
                
                // Рисуем изображение на canvas
                ctx.drawImage(img, 0, 0, width, height);
                
                // Конвертируем в blob
                canvas.toBlob(function(blob) {
                    if (blob && blob.size < file.size) {
                        // Создаем новый File объект с оригинальным именем
                        var compressedFile = new File([blob], file.name, {
                            type: file.type,
                            lastModified: Date.now()
                        });
                        callback(compressedFile);
                    } else {
                        // Если сжатие не помогло, используем оригинал
                        callback(file);
                    }
                }, file.type, quality);
            };
            img.onerror = function() {
                callback(file);
            };
            img.src = e.target.result;
        };
        reader.onerror = function() {
            callback(file);
        };
        reader.readAsDataURL(file);
    }

    function uploadProductFile(productId, file, isVideo, cb, onError) {
        var path = '/api/products/' + productId + (isVideo ? '/video' : '/image');
        var t = getToken();
        var url = API_BASE + path;
        var kind = isVideo ? 'Видео' : 'Фото';
        var fileName = file.name || 'файл';
        var originalSize = file.size || 0;
        
        // Для изображений сжимаем перед отправкой (только если файл больше 1 МБ)
        if (!isVideo && file.type && file.type.startsWith('image/') && originalSize > 1024 * 1024) {
            showUploadProgress(true, 0, 'Сжатие ' + kind.toLowerCase() + '…', '');
            compressImage(file, 1920, 1920, 0.85, function(compressedFile) {
                var fileSize = compressedFile.size || 0;
                var saved = originalSize > fileSize ? ' (сэкономлено ' + formatBytes(originalSize - fileSize) + ')' : '';
                if (saved) {
                    notify('Фото сжато' + saved, 'success');
                }
                proceedWithUpload(compressedFile, fileSize);
            });
            return;
        }
        
        proceedWithUpload(file, originalSize);
        
        function proceedWithUpload(fileToUpload, fileSize) {
            var formData = new FormData();
            formData.append('file', fileToUpload);

            var lastLoaded = 0;
            var lastTime = Date.now();
            var fill = document.getElementById('uploadProgressFill');
            if (fill) fill.style.width = '0%';

            uploadState.active = true;
            uploadState.realLoaded = 0;
            uploadState.realTotal = fileSize;
            uploadState.realPercent = 0;
            uploadState.realSpeedStr = '—';
            uploadState.displayedLoaded = 0;
            uploadState.displayedPercent = 0;
            uploadState.label = kind + ': ' + shortFileName(fileName);
            uploadState.total = fileSize;
            uploadState.indeterminate = !fileSize;

            if (uploadProgressRafId != null) cancelAnimationFrame(uploadProgressRafId);
            showUploadProgress(true, 0, uploadState.label, '0 из ' + formatBytes(fileSize) + ' (0%) · —');
            uploadProgressRafId = requestAnimationFrame(animateUploadProgress);

            var xhr = new XMLHttpRequest();
            xhr.open('POST', url);
            if (t) xhr.setRequestHeader('X-Admin-Token', t);
            xhr.upload.addEventListener('progress', function (e) {
                var loaded = e.loaded;
                var total = e.total;
                var now = Date.now();
                var elapsed = (now - lastTime) / 1000;
                var speed = elapsed > 0.05 ? (loaded - lastLoaded) / elapsed : 0;
                lastLoaded = loaded;
                lastTime = now;

                if (e.lengthComputable && total > 0) {
                    uploadState.indeterminate = false;
                    uploadState.realLoaded = loaded;
                    uploadState.realTotal = total;
                    uploadState.realPercent = Math.min(99, Math.round((loaded / total) * 1000) / 10);
                    uploadState.realSpeedStr = speed > 0 ? formatBytes(Math.round(speed)) + '/с' : '—';
                } else {
                    uploadState.realLoaded = loaded;
                    uploadState.realSpeedStr = speed > 0 ? formatBytes(Math.round(speed)) + '/с' : '—';
                }
            });
            xhr.onload = function () {
                uploadState.active = false;
                if (uploadProgressRafId != null) cancelAnimationFrame(uploadProgressRafId);
                uploadProgressRafId = null;
                uploadState.realPercent = 100;
                uploadState.realLoaded = fileSize;
                uploadState.displayedPercent = 100;
                uploadState.displayedLoaded = fileSize;
                var fill = document.getElementById('uploadProgressFill');
                if (fill) fill.style.width = '100%';
                
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        var data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
                        showUploadProgress(true, 100, kind + ' загружено', formatBytes(fileSize) + ' → привязано к товару');
                        notify(kind + ' успешно загружено и привязано к товару', 'success');
                        if (cb) cb(data);
                        setTimeout(function() { showUploadProgress(false); }, 800);
                    } catch (err) {
                        console.error('Ошибка парсинга ответа:', err, xhr.responseText);
                        notify('Ошибка ответа: ' + err.message, 'error');
                        showUploadProgress(false);
                        if (onError) onError();
                        if (cb) cb();
                    }
                } else {
                    var msg = xhr.responseText || 'Ошибка ' + xhr.status;
                    try {
                        var j = JSON.parse(xhr.responseText);
                        if (j.error) msg = j.error;
                    } catch (_) {}
                    notify('Ошибка загрузки ' + kind.toLowerCase() + ': ' + msg, 'error');
                    showUploadProgress(false);
                    if (onError) onError();
                }
            };
            xhr.onerror = function () {
                uploadState.active = false;
                if (uploadProgressRafId != null) cancelAnimationFrame(uploadProgressRafId);
                uploadProgressRafId = null;
                notify('Ошибка загрузки файла', 'error');
                showUploadProgress(false);
                if (onError) onError();
            };
            xhr.send(formData);
        }
    }

    function saveProduct() {
        const saveBtn = document.getElementById('saveProduct');
        const idEl = document.getElementById('productId');
        const id = idEl.value;
        const title = document.getElementById('productTitle').value.trim();
        const description = document.getElementById('productDescription').value.trim();
        const price = parseInt(document.getElementById('productPrice').value, 10);
        const category = document.getElementById('productCategory').value;
        var stockEl = document.getElementById('productStock');
        var stock = stockEl ? parseInt(stockEl.value, 10) : 0;
        if (isNaN(stock) || stock < 0) stock = 0;
        const imageInput = document.getElementById('productImage');
        const videoInput = document.getElementById('productVideo');
        if (!title || isNaN(price) || price < 0) {
            notify('Заполните название и цену', 'error');
            return;
        }
        function setBusy(busy) {
            if (saveBtn) {
                saveBtn.disabled = busy;
                saveBtn.textContent = busy ? '⏳ Сохранение…' : '💾 Сохранить';
            }
        }
        setBusy(true);
        const body = { title: title, description: description, price: price, category: category, stock: stock };
        const method = id ? 'PUT' : 'POST';
        const path = id ? '/api/products/' + id : '/api/products';
        api(path, { method: method, body: JSON.stringify(body) })
            .then(function (saved) {
                if (!saved) {
                    notify('Ошибка: товар не сохранён (нет ответа от сервера)', 'error');
                    setBusy(false);
                    return;
                }
                var productId = (saved && saved.id) ? saved.id : id;
                if (!productId) {
                    notify('Ошибка: товар сохранён, но ID не получен', 'error');
                    console.error('Ответ от сервера:', saved);
                    setBusy(false);
                    return;
                }
                var done = function () {
                    showUploadProgress(false);
                    notify('Товар успешно сохранён', 'success');
                    document.getElementById('modalProduct').classList.remove('active');
                    imageInput.value = '';
                    videoInput.value = '';
                    loadProducts();
                    loadStats();
                    setBusy(false);
                };
                if (imageInput.files && imageInput.files[0]) {
                    uploadProductFile(productId, imageInput.files[0], false, function () {
                        if (videoInput.files && videoInput.files[0]) {
                            uploadProductFile(productId, videoInput.files[0], true, done, setBusy.bind(null, false));
                        } else { 
                            done(); 
                        }
                    }, setBusy.bind(null, false));
                } else if (videoInput.files && videoInput.files[0]) {
                    uploadProductFile(productId, videoInput.files[0], true, done, setBusy.bind(null, false));
                } else {
                    done();
                }
            })
            .catch(function (err) {
                var errorMsg = 'Ошибка сохранения товара';
                if (err && err.message) {
                    errorMsg += ': ' + err.message;
                } else if (typeof err === 'string') {
                    errorMsg += ': ' + err;
                }
                console.error('Ошибка сохранения товара:', err);
                notify(errorMsg, 'error');
                setBusy(false);
            });
    }

    function deleteProduct(id) {
        if (!confirm('Удалить этот товар?')) return;
        api('/api/products/' + id, { method: 'DELETE' })
            .then(function () {
                notify('Товар удалён', 'success');
                loadProducts();
                loadStats();
            })
            .catch(function (e) { notify('Ошибка: ' + e.message, 'error'); });
    }

    function bindProductEvents() {
        // Кнопки обрабатываются через делегирование на #products (настроено один раз при загрузке)
    }

    // ——— Пользователи админки ———
    function loadAdminUsers() {
        var tbody = document.getElementById('adminUsersTableBody');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="4">Обновление…</td></tr>';
        api('/api/admin/users')
            .then(function (list) {
                if (!list || !list.length) {
                    tbody.innerHTML = '<tr><td colspan="4">Нет пользователей</td></tr>';
                    return;
                }
                // Убираем дубликаты по username на клиенте тоже
                var seen = {};
                var uniqueList = [];
                for (var i = 0; i < list.length; i++) {
                    var u = list[i];
                    var username = u.username || '';
                    if (!seen[username]) {
                        seen[username] = true;
                        uniqueList.push(u);
                    }
                }
                tbody.innerHTML = uniqueList.map(function (u) {
                    var created = u.created_at ? new Date(u.created_at).toLocaleDateString('ru-RU') : '—';
                    return '<tr><td>' + u.id + '</td><td>' + (u.username || '') + '</td><td>' + created + '</td><td><button type="button" class="action-btn delete-admin-user" data-id="' + u.id + '">Удалить</button></td></tr>';
                }).join('');
            })
            .catch(function (e) {
                tbody.innerHTML = '<tr><td colspan="4">Ошибка загрузки: ' + (e.message || 'Неизвестная ошибка') + '</td></tr>';
            });
    }

    function deleteAdminUser(id) {
        if (!confirm('Удалить этого пользователя? Он больше не сможет войти в панель.')) return;
        api('/api/admin/users/' + id, { method: 'DELETE' })
            .then(function () {
                notify('Пользователь удалён', 'success');
                // Небольшая задержка перед обновлением списка для гарантии
                setTimeout(function() {
                    loadAdminUsers();
                }, 300);
            })
            .catch(function (e) { notify(e.message || 'Ошибка', 'error'); });
    }

    // ——— Табы ———
    function switchToTab(tabId) {
        document.querySelectorAll('.nav-link').forEach(function (l) { l.classList.remove('active'); });
        document.querySelectorAll('.admin-tab').forEach(function (t) { t.classList.remove('active'); });
        var link = document.querySelector('.nav-link[data-tab="' + tabId + '"]');
        if (link) link.classList.add('active');
        var el = document.getElementById(tabId);
        if (el) el.classList.add('active');
        if (tabId === 'orders') loadOrders();
        if (tabId === 'completed') loadCompletedOrders();
        if (tabId === 'products') {
            var tableView = document.getElementById('productsTableView');
            var gridView = document.getElementById('productsGridView');
            var toggleBtn = document.getElementById('productsViewToggle');
            if (productsViewMode === 'grid') {
                if (tableView) tableView.style.display = 'none';
                if (gridView) gridView.style.display = 'grid';
                if (toggleBtn) toggleBtn.textContent = '📋 Список';
            } else {
                if (tableView) tableView.style.display = 'block';
                if (gridView) gridView.style.display = 'none';
                if (toggleBtn) toggleBtn.textContent = '🔲 Плитки';
            }
            loadProducts();
        }
        if (tabId === 'settings') {
            loadAdminUsers();
            loadEnvSettings();
        }
    }

    function renderEnvField(item) {
        var id = 'env_' + item.key;
        var placeholder = item.masked ? 'Оставьте пустым, чтобы не менять' : '';
        var type = item.masked ? 'password' : 'text';
        var val = (item.value || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        var label = '<label for="' + id + '">' + item.label + ' (' + item.key + ')</label>';
        var input = '<input type="' + type + '" id="' + id + '" class="form-input" value="' + val + '" placeholder="' + placeholder + '" data-masked="' + (item.masked ? '1' : '0') + '">';
        if (item.masked) {
            return '<div class="form-group">' + label + '<div class="env-field-wrap">' + input + '<button type="button" class="env-toggle-visibility" title="Показать значение" aria-label="Показать">👁</button></div></div>';
        }
        return '<div class="form-group">' + label + '<div class="env-field-wrap"><input type="text" id="' + id + '" class="form-input" value="' + val + '" placeholder="' + placeholder + '" data-masked="0"></div></div>';
    }

    function loadEnvSettings() {
        var envContainer = document.getElementById('envFormFields');
        if (envContainer) envContainer.innerHTML = '<p class="tab-desc">Загрузка…</p>';
        api('/api/settings/env')
            .then(function (list) {
                if (!list || !list.length) {
                    if (envContainer) envContainer.innerHTML = '<p class="tab-desc">Нет настроек</p>';
                    return;
                }
                var envItems = list.filter(function (item) { return item.group === 'env'; });
                if (envContainer) envContainer.innerHTML = envItems.length ? envItems.map(renderEnvField).join('') : '<p class="tab-desc">Нет переменных</p>';
            })
            .catch(function (e) {
                if (envContainer) envContainer.innerHTML = '<p class="tab-desc" style="color:var(--danger);">Ошибка: ' + e.message + '</p>';
            });
    }

    function loadBotTexts() {
        var container = document.getElementById('botTextsContainer');
        var msgEl = document.getElementById('botTextsMessage');
        if (!container) return;
        container.innerHTML = '<p class="tab-desc">Загрузка…</p>';
        if (msgEl) { msgEl.style.display = 'none'; msgEl.textContent = ''; }
        api('/api/settings/bot-texts')
            .then(function (list) {
                if (!list || !list.length) {
                    container.innerHTML = '<p class="tab-desc">Нет текстов</p>';
                    return;
                }
                var html = '<table class="data-table bot-texts-table"><thead><tr><th>Ключ</th><th>🇷🇺 Русский</th><th>🇹🇯 Тоҷикӣ</th></tr></thead><tbody>';
                list.forEach(function (item) {
                    var k = (item.key || '').replace(/</g, '&lt;');
                    var ru = (item.ru || '').replace(/</g, '&lt;').replace(/"/g, '&quot;');
                    var tg = (item.tg || '').replace(/</g, '&lt;').replace(/"/g, '&quot;');
                    html += '<tr><td class="bot-text-key"><code>' + k + '</code></td>';
                    html += '<td><textarea class="form-input bot-text-area" data-key="' + k + '" data-lang="ru" rows="2">' + ru + '</textarea></td>';
                    html += '<td><textarea class="form-input bot-text-area" data-key="' + k + '" data-lang="tg" rows="2">' + tg + '</textarea></td></tr>';
                });
                html += '</tbody></table>';
                container.innerHTML = html;
            })
            .catch(function (e) {
                container.innerHTML = '<p class="tab-desc" style="color:var(--danger);">Ошибка: ' + e.message + '</p>';
            });
    }

    function saveBotTexts() {
        var areas = document.querySelectorAll('#botTextsContainer .bot-text-area');
        if (!areas.length) return;
        var byKey = {};
        areas.forEach(function (el) {
            var key = el.getAttribute('data-key');
            var lang = el.getAttribute('data-lang');
            if (!byKey[key]) byKey[key] = {};
            byKey[key][lang] = (el.value || '').trim();
        });
        var texts = Object.keys(byKey).map(function (key) { return { key: key, ru: byKey[key].ru, tg: byKey[key].tg }; });
        var btn = document.getElementById('saveBotTextsBtn');
        var msgEl = document.getElementById('botTextsMessage');
        if (btn) btn.disabled = true;
        api('/api/settings/bot-texts', { method: 'PUT', body: JSON.stringify({ texts: texts }) })
            .then(function (data) {
                notify(data.message || 'Тексты сохранены.', 'success');
                if (msgEl) { msgEl.textContent = '✓ ' + (data.message || 'Перезапустите бота.'); msgEl.style.display = 'block'; msgEl.style.color = 'var(--accent)'; }
            })
            .catch(function (e) {
                notify(e.message || 'Ошибка', 'error');
                if (msgEl) { msgEl.textContent = 'Ошибка: ' + e.message; msgEl.style.display = 'block'; msgEl.style.color = 'var(--danger)'; }
            })
            .finally(function () { if (btn) btn.disabled = false; });
    }

    document.body.addEventListener('click', function (e) {
        var btn = e.target.closest('.env-toggle-visibility');
        if (!btn) return;
        var wrap = btn.closest('.env-field-wrap');
        if (!wrap) return;
        var input = wrap.querySelector('input');
        if (!input) return;
        e.preventDefault();
        if (input.type === 'password') {
            var key = input.id.replace(/^env_/, '');
            var curVal = (input.value || '').trim();
            if (/^••••/.test(curVal) && key) {
                btn.disabled = true;
                api('/api/settings/env/raw?key=' + encodeURIComponent(key))
                    .then(function (r) {
                        input.value = r.value || '';
                        input.type = 'text';
                        btn.textContent = '🙈';
                        btn.title = 'Скрыть значение';
                    })
                    .catch(function (err) {
                        notify(err.message || 'Не удалось загрузить значение', 'error');
                    })
                    .finally(function () { btn.disabled = false; });
            } else {
                input.type = 'text';
                btn.textContent = '🙈';
                btn.title = 'Скрыть значение';
            }
        } else {
            var v = (input.value || '').trim();
            if (v.length > 4) input.value = '••••••••' + v.slice(-4);
            input.type = 'password';
            btn.textContent = '👁';
            btn.title = 'Показать значение';
        }
    });

    function saveEnvSettings(containerId, btnId, messageId) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var list = container.querySelectorAll('.form-group input');
        var body = {};
        list.forEach(function (input) {
            var key = input.id.replace(/^env_/, '');
            var val = (input.value || '').trim();
            if (!val) return;
            if (/^••••/.test(val)) return;
            body[key] = val;
        });
        if (Object.keys(body).length === 0) {
            notify('Введите хотя бы одно значение для сохранения', 'error');
            return;
        }
        var btn = document.getElementById(btnId);
        var msgEl = document.getElementById(messageId);
        if (btn) btn.disabled = true;
        api('/api/settings/env', { method: 'PUT', body: JSON.stringify(body) })
            .then(function (data) {
                notify(data.message || 'Сохранено.', 'success');
                if (msgEl) {
                    msgEl.textContent = '✓ ' + (data.message || 'Сохранено. Перезапустите бота для применения.');
                    msgEl.style.display = 'block';
                    msgEl.style.color = 'var(--accent)';
                }
                loadEnvSettings();
            })
            .catch(function (e) {
                notify(e.message || 'Ошибка сохранения', 'error');
                if (msgEl) {
                    msgEl.textContent = 'Ошибка: ' + e.message;
                    msgEl.style.display = 'block';
                    msgEl.style.color = 'var(--danger)';
                }
            })
            .finally(function () {
                if (btn) btn.disabled = false;
            });
    }

    function initTabs() {
        document.querySelectorAll('.nav-link[data-tab]').forEach(function (link) {
            link.addEventListener('click', function (e) {
                e.preventDefault();
                switchToTab(this.getAttribute('data-tab'));
            });
        });
    }

    // ——— Дашборд: клик по карточке — переход в заказы/товары с фильтром ———
    function initDashboardClicks() {
        document.querySelectorAll('.stat-card.clickable').forEach(function (card) {
            card.addEventListener('click', function () {
                var goto = this.getAttribute('data-goto');
                var filterStatus = this.getAttribute('data-filter-status');
                var filterStock = this.getAttribute('data-filter-stock');
                if (!goto) return;
                if (goto === 'orders' && filterStatus !== null) {
                    var statusEl = document.getElementById('filterOrderStatus');
                    if (statusEl) statusEl.value = filterStatus || '';
                }
                if (goto === 'products' && filterStock !== null) {
                    var stockEl = document.getElementById('filterProductStock');
                    if (stockEl) stockEl.value = filterStock || '';
                }
                switchToTab(goto);
            });
        });
    }

    // ——— Инициализация ———
    document.addEventListener('DOMContentLoaded', function () {
        var loginScreen = document.getElementById('loginScreen');
        var appPanel = document.getElementById('appPanel');

        if (!getToken()) {
            loginScreen.style.display = 'flex';
            appPanel.style.display = 'none';
        } else {
            loginScreen.style.display = 'none';
            appPanel.style.display = 'flex';
            var unEl = document.getElementById('currentUsername');
            if (unEl) unEl.textContent = getUsername() || '—';
            loadStats();
        }

        document.getElementById('loginForm').addEventListener('submit', function (e) {
            e.preventDefault();
            var username = (document.getElementById('loginUsername').value || '').trim();
            var secretKey = document.getElementById('loginSecretKey').value || '';
            var errEl = document.getElementById('loginError');
            var submitBtn = document.querySelector('#loginForm button[type="submit"]');
            errEl.textContent = '';
            if (!username || !secretKey) {
                errEl.textContent = 'Введите имя и секретный ключ';
                return;
            }
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Вход...';
            }
            fetch(API_BASE + '/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: username, secret_key: secretKey })
            })
                .then(function (res) {
                    return res.json().then(function (data) {
                        if (!res.ok) {
                            var errorMsg = data.error || res.statusText || 'Ошибка входа';
                            throw new Error(errorMsg);
                        }
                        return data;
                    });
                })
                .then(function (data) {
                    console.log('Получен токен при входе:', data.token ? data.token.substring(0, 30) + '...' : 'отсутствует');
                    setToken(data.token);
                    setUsername(data.username || username);
                    logoutForbidden = false;
                    var unEl = document.getElementById('currentUsername');
                    if (unEl) unEl.textContent = data.username || username;
                    loginScreen.style.display = 'none';
                    appPanel.style.display = 'flex';
                    errEl.textContent = '';
                    document.getElementById('loginSecretKey').value = '';
                    // Кнопка уведомлений уже видна (она в header)
                    // Проверяем, что токен сохранился
                    var savedToken = getToken();
                    console.log('Токен сохранен в localStorage:', savedToken ? savedToken.substring(0, 30) + '...' : 'отсутствует');
                    loadStats();
                    notify('Вход выполнен', 'success');
                })
                .catch(function (e) {
                    errEl.textContent = e.message || 'Ошибка входа';
                    console.error('Ошибка входа:', e);
                })
                .finally(function () {
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.textContent = 'Войти';
                    }
                });
        });

        var logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) logoutBtn.addEventListener('click', logout);

        document.getElementById('refreshData').addEventListener('click', function () {
            loadStats();
            var tab = document.querySelector('.admin-tab.active');
            if (tab && tab.id === 'orders') loadOrders();
            if (tab && tab.id === 'completed') loadCompletedOrders();
            if (tab && tab.id === 'products') loadProducts();
            if (tab && tab.id === 'settings') loadAdminUsers();
            notify('Данные обновлены', 'success');
        });
        document.getElementById('loadOrders').addEventListener('click', loadOrders);
        document.getElementById('btnAddOrder').addEventListener('click', function () {
            document.getElementById('orderUserId').value = '';
            document.getElementById('orderProductId').innerHTML = '<option value="">Загрузка списка…</option>';
            document.getElementById('orderFullName').value = '';
            document.getElementById('orderPhone').value = '';
            document.getElementById('orderCity').value = '';
            document.getElementById('orderAddress').value = '';
            document.getElementById('modalOrder').classList.add('active');
            api('/api/products').then(function (products) {
                var select = document.getElementById('orderProductId');
                select.innerHTML = '<option value="">Выберите товар...</option>';
                products.forEach(function (p) {
                    var opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = (p.title || '') + ' — ' + (p.price || 0) + ' сом.';
                    select.appendChild(opt);
                });
            }).catch(function () {
                document.getElementById('orderProductId').innerHTML = '<option value="">Ошибка загрузки</option>';
            });
        });
        document.getElementById('closeOrder').addEventListener('click', function () {
            document.getElementById('modalOrder').classList.remove('active');
        });
        document.getElementById('modalOrder').addEventListener('click', function (e) {
            if (e.target === this) this.classList.remove('active');
        });
        document.getElementById('saveOrder').addEventListener('click', function () {
            var userId = parseInt(document.getElementById('orderUserId').value, 10);
            var productId = parseInt(document.getElementById('orderProductId').value, 10);
            var fullName = document.getElementById('orderFullName').value.trim();
            var phone = document.getElementById('orderPhone').value.trim();
            var city = document.getElementById('orderCity').value.trim();
            var address = document.getElementById('orderAddress').value.trim();
            if (!userId || !productId || !fullName || !phone || !city || !address) {
                notify('Заполните все поля', 'error');
                return;
            }
            api('/api/orders', {
                method: 'POST',
                body: JSON.stringify({ user_id: userId, product_id: productId, full_name: fullName, phone: phone, city: city, address: address })
            })
                .then(function () {
                    document.getElementById('modalOrder').classList.remove('active');
                    loadOrders();
                    loadStats();
                    notify('Заказ создан', 'success');
                })
                .catch(function (e) { notify(e.message || 'Ошибка', 'error'); });
        });
        const exportBtn = document.getElementById('exportOrdersCsv');
        if (exportBtn) exportBtn.addEventListener('click', exportOrdersCsv);
        const backupBtn = document.getElementById('backupDbBtn');
        if (backupBtn) backupBtn.addEventListener('click', function () {
            var url = API_BASE + '/api/backup';
            var t = getToken();
            if (t) url += '?token=' + encodeURIComponent(t);
            fetch(url, { headers: t ? { 'X-Admin-Token': t } : {} })
                .then(function (res) {
                    if (res.status === 403) { notify('Доступ запрещён', 'error'); return null; }
                    if (!res.ok) throw new Error(res.statusText);
                    return res.blob();
                })
                .then(function (blob) {
                    if (!blob) return;
                    var a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = 'laptops.db';
                    a.click();
                    URL.revokeObjectURL(a.href);
                    notify('Файл laptops.db сохранён', 'success');
                })
                .catch(function (e) { notify('Ошибка бэкапа: ' + e.message, 'error'); });
        });
        var loadCompletedBtn = document.getElementById('loadCompletedOrders');
        if (loadCompletedBtn) loadCompletedBtn.addEventListener('click', loadCompletedOrders);
        var exportCompletedBtn = document.getElementById('exportCompletedCsv');
        if (exportCompletedBtn) exportCompletedBtn.addEventListener('click', function () {
            var t = getToken();
            var url = API_BASE + '/api/orders/export?status=shipped' + (t ? '&token=' + encodeURIComponent(t) : '');
            fetch(url, { headers: t ? { 'X-Admin-Token': t } : {} })
                .then(function (res) {
                    if (!res.ok) throw new Error(res.statusText);
                    return res.blob();
                })
                .then(function (blob) {
                    var a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = 'orders_completed.csv';
                    a.click();
                    URL.revokeObjectURL(a.href);
                    notify('Файл orders_completed.csv сохранён', 'success');
                })
                .catch(function (e) { notify('Ошибка: ' + e.message, 'error'); });
        });
        const loadProductsBtn = document.getElementById('loadProducts');
        if (loadProductsBtn) loadProductsBtn.addEventListener('click', loadProducts);
        const productsViewToggle = document.getElementById('productsViewToggle');
        if (productsViewToggle) {
            productsViewToggle.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                toggleProductsView();
            });
            var tableView = document.getElementById('productsTableView');
            var gridView = document.getElementById('productsGridView');
            if (productsViewMode === 'grid') {
                if (tableView) tableView.style.display = 'none';
                if (gridView) gridView.style.display = 'grid';
                productsViewToggle.textContent = '📋 Список';
            } else {
                if (tableView) tableView.style.display = 'block';
                if (gridView) gridView.style.display = 'none';
                productsViewToggle.textContent = '🔲 Плитки';
            }
        }
        document.getElementById('btnAddProduct').addEventListener('click', function () { openProductModal(null); });
        document.getElementById('saveProduct').addEventListener('click', saveProduct);
        document.body.addEventListener('click', function (e) {
            var productsContainer = document.getElementById('products');
            if (!productsContainer || !productsContainer.contains(e.target)) return;
            var editBtn = e.target.closest('.edit-product');
            if (editBtn) {
                e.preventDefault();
                e.stopPropagation();
                var id = editBtn.getAttribute('data-id');
                if (id) openProductModal(id);
                return;
            }
            var delBtn = e.target.closest('.delete-product');
            if (delBtn) {
                e.preventDefault();
                e.stopPropagation();
                var id = delBtn.getAttribute('data-id');
                if (id) deleteProduct(id);
            }
        });
        document.getElementById('closeReceipt').addEventListener('click', function () {
            document.getElementById('modalReceipt').classList.remove('active');
        });
        document.getElementById('closeProduct').addEventListener('click', function () {
            document.getElementById('modalProduct').classList.remove('active');
        });
        document.getElementById('modalReceipt').addEventListener('click', function (e) {
            if (e.target === this) this.classList.remove('active');
        });
        document.getElementById('modalProduct').addEventListener('click', function (e) {
            if (e.target === this) this.classList.remove('active');
        });

        document.getElementById('btnAddAdminUser').addEventListener('click', function () {
            document.getElementById('newAdminUsername').value = '';
            document.getElementById('newAdminSecretKey').value = '';
            document.getElementById('modalAdminUser').classList.add('active');
        });
        document.getElementById('closeAdminUser').addEventListener('click', function () {
            document.getElementById('modalAdminUser').classList.remove('active');
        });
        document.getElementById('modalAdminUser').addEventListener('click', function (e) {
            if (e.target === this) this.classList.remove('active');
        });
        var adminUsersTbody = document.getElementById('adminUsersTableBody');
        if (adminUsersTbody) {
            adminUsersTbody.addEventListener('click', function (e) {
                var btn = e.target.closest && e.target.closest('.delete-admin-user');
                if (btn) {
                    e.preventDefault();
                    deleteAdminUser(btn.getAttribute('data-id'));
                }
            });
        }
        document.getElementById('saveAdminUser').addEventListener('click', function () {
            var username = (document.getElementById('newAdminUsername').value || '').trim();
            var secretKey = document.getElementById('newAdminSecretKey').value || '';
            if (!username) { notify('Введите имя пользователя', 'error'); return; }
            if (secretKey.length < 4) { notify('Секретный ключ не менее 4 символов', 'error'); return; }
            api('/api/admin/users', {
                method: 'POST',
                body: JSON.stringify({ username: username, secret_key: secretKey })
            })
                .then(function () {
                    document.getElementById('modalAdminUser').classList.remove('active');
                    loadAdminUsers();
                    notify('Пользователь «' + username + '» создан. Передайте ему имя и ключ для входа.', 'success');
                })
                .catch(function (e) { notify(e.message || 'Ошибка', 'error'); });
        });
        var saveEnvBtn = document.getElementById('saveEnvBtn');
        if (saveEnvBtn) saveEnvBtn.addEventListener('click', function () { saveEnvSettings('envFormFields', 'saveEnvBtn', 'envSaveMessage'); });
        var saveBotBtn = document.getElementById('saveBotBtn');
        if (saveBotBtn) saveBotBtn.addEventListener('click', function () { saveEnvSettings('botFormFields', 'saveBotBtn', 'botSaveMessage'); });
        document.querySelectorAll('.settings-subtab').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var panelId = this.getAttribute('data-settings-panel');
                if (!panelId) return;
                document.querySelectorAll('.settings-subtab').forEach(function (b) { b.classList.remove('active'); });
                document.querySelectorAll('.settings-panel').forEach(function (p) { p.classList.remove('active'); });
                this.classList.add('active');
                var panel = document.getElementById('settingsPanel' + panelId.charAt(0).toUpperCase() + panelId.slice(1));
                if (panel) panel.classList.add('active');
                if (panelId === 'bot') loadBotTexts();
            });
        });
        var loadBotTextsBtn = document.getElementById('loadBotTextsBtn');
        if (loadBotTextsBtn) loadBotTextsBtn.addEventListener('click', loadBotTexts);
        var saveBotTextsBtn = document.getElementById('saveBotTextsBtn');
        if (saveBotTextsBtn) saveBotTextsBtn.addEventListener('click', saveBotTexts);

        initTabs();
        initDashboardClicks();
        
        // Инициализация кнопки уведомлений
        var notificationsBtn = document.getElementById('notificationsButton');
        var closeBtn = document.getElementById('closeNotificationsDropdown');
        var overlay = document.getElementById('notificationsOverlay');
        
        if (notificationsBtn) {
            notificationsBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                toggleNotificationsDropdown();
            });
        }
        
        if (closeBtn) {
            closeBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                closeNotificationsDropdown();
            });
        }
        
        if (overlay) {
            overlay.addEventListener('click', function() {
                closeNotificationsDropdown();
            });
        }
        
        // Закрываем меню при клике вне его
        document.addEventListener('click', function(e) {
            var dropdown = document.getElementById('notificationsDropdown');
            var wrapper = document.querySelector('.notifications-wrapper');
            if (dropdown && wrapper && !wrapper.contains(e.target)) {
                closeNotificationsDropdown();
            }
        });
        
        if (getToken()) loadStats();

        setInterval(function () {
            if (!getToken()) return;
            loadStats();
            var tab = document.querySelector('.admin-tab.active');
            if (tab && tab.id === 'orders') loadOrders();
            if (tab && tab.id === 'completed') loadCompletedOrders();
            if (tab && tab.id === 'products') loadProducts();
        }, 45000);
    });
})();
