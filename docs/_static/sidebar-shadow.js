// Marks the sidebar as scrolled once nav content sits under the search bar,
// so the stylesheet shows the bar's drop shadow only then.
const scroller = document.querySelector(".sidebar-scroll");
const drawer = document.querySelector(".sidebar-drawer");

if (scroller && drawer) {
  const update = () => {
    drawer.toggleAttribute("data-scrolled", scroller.scrollTop > 0);
  };
  scroller.addEventListener("scroll", update, { passive: true });
  update();
}
