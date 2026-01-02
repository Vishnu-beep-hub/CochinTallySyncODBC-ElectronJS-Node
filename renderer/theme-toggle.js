(function(){
  // Nav theme toggle — finds elements by IDs and wires to window.tallyDark
  function init() {
    if (!window.tallyDark) return
    const checkbox = document.getElementById('navThemeToggle')
    const btn = document.getElementById('navThemeBtn')
    const setIcon = (isDark) => {
      if (!btn) return
      btn.innerHTML = isDark ? '\u{1F319}' : '\u{2600}' // moon / sun
    }

    const current = window.tallyDark.get()
    if (checkbox) checkbox.checked = current
    setIcon(current)

    const apply = (v) => {
      window.tallyDark.set(!!v)
      if (checkbox) checkbox.checked = !!v
      setIcon(!!v)
    }

    if (checkbox) checkbox.addEventListener('change', (e) => apply(e.target.checked))
    if (btn) btn.addEventListener('click', () => apply(!(checkbox ? checkbox.checked : window.tallyDark.get())))
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
