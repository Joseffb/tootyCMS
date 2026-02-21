(function () {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-tooty-theme", "tooty-dark");

  if (window.__tootyThemeArtMounted) return;
  window.__tootyThemeArtMounted = true;

  const nonLibraryNames = [
    "tooty-dark-heavy-sigh.png",
    "tooty-dark-trash-writing.png",
    "tooty-dark-burned-out.png",
    "tooty-dark-restless.png",
    "tooty-dark-angry-driving.png",
    "tooty-dark-whatever.png",
    "tooty-dark-night-restless.png",
  ];

  function pickRandomName() {
    return nonLibraryNames[Math.floor(Math.random() * nonLibraryNames.length)];
  }

  function renderThemeArtSlots() {
    const slots = document.querySelectorAll("[data-theme-slot='header-art']");
    slots.forEach((slot) => {
      if (!(slot instanceof HTMLElement)) return;
      if (slot.dataset.themeArtReady === "1") return;

      const context = slot.closest("[data-theme-context]");
      const docSlug = (context?.getAttribute("data-theme-doc-category-slug") || "documentation").toLowerCase();
      const termSlug = (context?.getAttribute("data-theme-term-slug") || "").toLowerCase();
      const categorySlugs = (context?.getAttribute("data-theme-category-slugs") || "")
        .split(",")
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean);
      const publicBase = (context?.getAttribute("data-theme-public-image-base") || "/theme-assets/tooty-dark").replace(/\/+$/, "");

      const isDocumentation = termSlug === docSlug || categorySlugs.includes(docSlug);
      const fileName = isDocumentation ? "tooty-dark-meh-reading.png" : pickRandomName();
      const src = `${publicBase}/mascots/${fileName}`;

      const img = document.createElement("img");
      img.src = src;
      img.alt = "Theme art";
      img.className = "theme-header-art-image";
      slot.appendChild(img);
      slot.dataset.themeArtReady = "1";
    });
  }

  renderThemeArtSlots();
  const observer = new MutationObserver(() => renderThemeArtSlots());
  observer.observe(document.body, { childList: true, subtree: true });
})();
