/*!
 * theme.js —— 明暗主题切换
 * ---------------------------------------------------------------------------
 * 移植自 https://www.hooay233.top/theme.js，保留它的核心机制：
 *   1. <body> 上挂 .dark-mode，并遍历所有元素切换 .dark_style 类；
 *   2. 切换时克隆整页 + clip-path 从右向左扫开 + 一条 4px 扫描线（转场动画）；
 *   3. Firefox 直接切换，不做动画（原站的兼容处理）；
 *   4. 按钮文案：「切换到暗色模式 / 切换到亮色模式」。
 * 改动：
 *   · 主题记忆用 localStorage，key = blog-theme，值 dark / light（原站不记忆）；
 *   · 不再用 HTML 内联 onclick，改为在这里绑定 #theme-toggle；
 *   · 对外暴露 window.Theme = { apply, toggle, ... } 供 js/site.js 调用；
 *   · 顶部【同步】执行一次主题应用：theme.js 带 defer，脚本在 DOM 解析完成后
 *     立即执行（早于 DOMContentLoaded），因此同步执行比等 DOMContentLoaded
 *     更快上色，尽量抢在首次绘制前，避免暗色模式闪白。
 *   · 只给「实际变化的子树」提供 applyToNode，方便 site.js 渲染完文章列表后
 *     只标记新增节点，不必整页重扫。
 * ---------------------------------------------------------------------------
 * 对外 API（window.Theme）：
 *   Theme.apply(isDark, persist)  应用主题；persist !== false 时写入 localStorage
 *   Theme.apply(isDark)           → 直接调用即可，默认会持久化
 *   Theme.toggle()                切换主题（带动画），并持久化
 *   Theme.applyToNode(node, isDark) 只给某个子树打/去 dark_style（渲染后补标）
 *   Theme.walkToggle(node, isDark)  同上的底层函数（含 node 自身）
 *   Theme.isDark()                当前是否暗色
 *   Theme.STORAGE_KEY / DARK_MODE_CLASS / NODE_CLASS / isFirefox
 *   document 上的 'themechange' 事件（detail.dark），仅在主题【真的变化】时派发，
 *   所以监听者里再调用 apply() 也不会形成死循环。
 */
(function () {
	'use strict';

	var STORAGE_KEY = 'blog-theme';
	var DARK_MODE_CLASS = 'dark-mode';	/* 挂在 <html> / <body> */
	var NODE_CLASS = 'dark_style';		/* 原站机制：每个元素都打一个 */
	var TOGGLE_ID = 'theme-toggle';
	var TEXT_DARK = '切换到暗色模式';
	var TEXT_LIGHT = '切换到亮色模式';

	var isFirefox = navigator.userAgent.toLowerCase().indexOf('firefox') > -1;

	var switchBtn = null;
	var currentDark = null;		/* null = 还没应用过，这样首次 apply 一定会派发事件 */
	var transitioning = false;

	/* ------------------------------------------------------------------ 存储 */

	function readStored() {
		try {
			var v = localStorage.getItem(STORAGE_KEY);
			if (v === 'dark') return true;
			if (v === 'light') return false;
		} catch (e) { /* 隐私模式 / 禁用存储：忽略 */ }
		return false;	/* 默认亮色，与原站一致（原站只初始化亮色） */
	}

	function writeStored(isDark) {
		try {
			localStorage.setItem(STORAGE_KEY, isDark ? 'dark' : 'light');
		} catch (e) { /* 忽略 */ }
	}

	/* -------------------------------------------------------------- 类名切换 */

	/** 给 root 自身 + 全部后代切换 dark_style（原站 walkToggle 原样保留） */
	function walkToggle(root, isDark) {
		if (!root || !root.querySelectorAll) return;
		var all = root.querySelectorAll('*');
		for (var i = 0; i < all.length; i++) {
			all[i].classList.toggle(NODE_CLASS, isDark);
		}
		if (root.classList) root.classList.toggle(NODE_CLASS, isDark);
	}

	function updateSwitchText(isDark) {
		if (!switchBtn) return;
		switchBtn.textContent = isDark ? TEXT_LIGHT : TEXT_DARK;
		switchBtn.setAttribute('aria-label', isDark ? TEXT_LIGHT : TEXT_DARK);
		switchBtn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
	}

	/* ------------------------------------------------------------ 应用主题 */

	/**
	 * 应用主题。
	 * @param {boolean} isDark
	 * @param {boolean} [persist=true] 是否写 localStorage
	 */
	function apply(isDark, persist) {
		isDark = !!isDark;
		if (persist !== false) writeStored(isDark);

		var changed = (isDark !== currentDark);
		currentDark = isDark;

		var root = document.documentElement;
		if (root) {
			root.classList.toggle(DARK_MODE_CLASS, isDark);
			/* color-scheme 让表单控件/滚动条跟着变，也顺手压掉白底闪烁 */
			root.style.colorScheme = isDark ? 'dark' : 'light';
		}

		if (document.body) {
			document.body.classList.toggle(DARK_MODE_CLASS, isDark);
			walkToggle(document.body, isDark);
		}

		updateSwitchText(isDark);

		if (changed) {
			try {
				document.dispatchEvent(new CustomEvent('themechange', { detail: { dark: isDark } }));
			} catch (e) { /* 老浏览器没有 CustomEvent：忽略 */ }
		}
		return isDark;
	}

	/** 只给某个子树补/去 dark_style（site.js 渲染完新卡片后调用最省） */
	function applyToNode(root, isDark) {
		if (root) walkToggle(root, typeof isDark === 'boolean' ? isDark : !!currentDark);
	}

	function isDark() {
		return !!currentDark;
	}

	/* ------------------------------------------------------------ 转场动画 */

	function createTransitionOverlay(newIsDark) {
		var overlay = document.createElement('div');
		overlay.className = 'theme-transition-overlay';

		var newPanel = document.createElement('div');
		newPanel.className = 'panel';
		newPanel.style.backgroundColor = newIsDark ? '#333' : '#f0f0f0';

		var scrollX = window.scrollX || window.pageXOffset || 0;
		var scrollY = window.scrollY || window.pageYOffset || 0;

		var cloneWrapper = document.createElement('div');
		cloneWrapper.className = 'page-clone';
		cloneWrapper.style.position = 'absolute';
		cloneWrapper.style.top = (-scrollY) + 'px';
		cloneWrapper.style.left = (-scrollX) + 'px';
		cloneWrapper.style.padding = getComputedStyle(document.body).padding;
		cloneWrapper.style.width = '100%';
		cloneWrapper.style.height = '100%';
		cloneWrapper.style.boxSizing = 'border-box';

		/* 克隆当前页面；克隆体脱离了 body 的 .dark-mode 作用域，
		   所以必须把 dark_style 打到整棵克隆子树上，它才自带目标配色。 */
		var source = document.querySelector('.page-wrap') || document.body;
		var clone = source.cloneNode(true);
		walkToggle(clone, newIsDark);
		cloneWrapper.appendChild(clone);
		newPanel.appendChild(cloneWrapper);

		var scanline = document.createElement('div');
		scanline.className = 'scanline';
		newPanel.appendChild(scanline);

		overlay.appendChild(newPanel);

		return { overlay: overlay, newPanel: newPanel };
	}

	function setBusy(busy) {
		transitioning = busy;
		if (!switchBtn) return;
		/* 原站就是这样当"忙碌标记"用的：动画期间按钮带着 spcbtn_disabled，
		   于是点击只会触发抖动反馈，不会重复开动画。 */
		if (busy) switchBtn.classList.add('spcbtn_disabled');
		else switchBtn.classList.remove('spcbtn_disabled');
	}

	function finishTransition(newIsDark, overlay) {
		apply(newIsDark);
		if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
		setBusy(false);
	}

	function toggle() {
		if (transitioning) return currentDark;
		var newIsDark = !currentDark;

		if (isFirefox) {
			/* Firefox: 跳过 clip-path 动画，直接切换 */
			apply(newIsDark);
			return newIsDark;
		}

		setBusy(true);

		var built = createTransitionOverlay(newIsDark);
		document.body.appendChild(built.overlay);

		requestAnimationFrame(function () {
			built.newPanel.classList.add('active');
		});

		var finished = false;
		function finish() {
			if (finished) return;
			finished = true;
			finishTransition(newIsDark, built.overlay);
		}

		built.newPanel.addEventListener('transitionend', function (ev) {
			if (ev.target !== built.newPanel) return;
			if (ev.propertyName && ev.propertyName.indexOf('clip') === -1) return;
			finish();
		});

		/* 兜底：transitionend 偶发不触发时强制收尾 */
		setTimeout(function () {
			if (finished) return;
			built.newPanel.style.clipPath = 'inset(0 0 0 0)';
			finish();
		}, 1500);

		return newIsDark;
	}

	/* ------------------------------------------------------------ 事件绑定 */

	function bindListeners() {
		if (switchBtn && !switchBtn.__themeBound) {
			switchBtn.__themeBound = true;
			switchBtn.addEventListener('click', function (ev) {
				ev.preventDefault();
				toggle();
			});
		}

		/* 原站「点一下抖动」的钩子，改成委托到 document：
		   动态生成的按钮（分页、标签…）同样有效。
		   注意：这里【绝不】调用 preventDefault / stopPropagation，
		   否则会挡住表单提交和 site.js 自己的处理器（原站在这里 preventDefault，
		   对 type="submit" 的搜索按钮是致命的，所以去掉了）。 */
		if (!document.__themeShakeBound) {
			document.__themeShakeBound = true;

			document.addEventListener('click', function (ev) {
				var el = ev.target;
				while (el && el !== document && !(el.classList && el.classList.contains('spcbtn_disabled'))) {
					el = el.parentNode;
				}
				if (!el || el === document || !el.classList) return;
				el.classList.remove('shake');
				void el.offsetWidth;	/* 强制重排，让动画能重新触发 */
				el.classList.add('shake');
			}, false);

			document.addEventListener('animationend', function (ev) {
				if (ev.animationName === 'shake-head' && ev.target && ev.target.classList) {
					ev.target.classList.remove('shake');
				}
			}, false);
		}
	}

	/* ------------------------------------------------------------------ 启动 */

	function boot() {
		switchBtn = document.getElementById(TOGGLE_ID);
		/* 顶部同步应用一次：此时 body 已就绪，能赶在首次绘制前把主题定下来 */
		apply(readStored(), false);
		bindListeners();
	}

	/* 尽早执行。带 defer 时 body 一定已存在，直接 boot()；
	   万一被放到 <head> 且没加 defer，则先给 <html> 上色（防止闪白），
	   等 DOM 就绪再补全 body 上的类。 */
	if (document.body) {
		boot();
	} else {
		var initialDark = readStored();
		if (document.documentElement) {
			document.documentElement.classList.toggle(DARK_MODE_CLASS, initialDark);
			document.documentElement.style.colorScheme = initialDark ? 'dark' : 'light';
		}
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', boot);
		} else {
			boot();
		}
	}

	/* -------------------------------------------------------------- 对外 API */

	window.Theme = {
		STORAGE_KEY: STORAGE_KEY,
		DARK_MODE_CLASS: DARK_MODE_CLASS,
		NODE_CLASS: NODE_CLASS,
		isFirefox: isFirefox,

		apply: apply,
		applyToNode: applyToNode,
		walkToggle: walkToggle,
		toggle: toggle,
		isDark: isDark
	};
})();
