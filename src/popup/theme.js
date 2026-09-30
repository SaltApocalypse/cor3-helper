// --- Theme Selection ---

const themeToggleBtn = document.getElementById('themeToggleBtn');
const themeDropdown = document.getElementById('themeDropdown');
const themeOptions = themeDropdown.querySelectorAll('.theme-option');

function applyTheme(themeName) {
    document.body.classList.forEach(cls => { if (cls.startsWith('theme-')) document.body.classList.remove(cls); });
    if (themeName) {
        document.body.classList.add('theme-' + themeName);
    }

    themeOptions.forEach(opt => {
        opt.classList.toggle('active', opt.dataset.theme === themeName);
    });
}

// Load saved theme immediately
chrome.storage.sync.get('selectedTheme', (data) => {
    applyTheme(data.selectedTheme || 'default');
});

themeToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    themeDropdown.classList.toggle('open');
});

themeOptions.forEach(opt => {
    opt.addEventListener('click', async (e) => {
        e.stopPropagation();
        const theme = opt.dataset.theme;
        applyTheme(theme);
        await chrome.storage.sync.set({ selectedTheme: theme });
        themeDropdown.classList.remove('open');
    });
});

// Close dropdown when clicking elsewhere
document.addEventListener('click', () => {
    themeDropdown.classList.remove('open');
});
