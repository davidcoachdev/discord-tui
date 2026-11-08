import type { Store } from "../../src/store/store";

/**
 * Demo de presencia: el total de miembros de un server grande en el título del panel.
 * Sin `ops`, así la lista sigue saliendo de los miembros conocidos de la demo.
 */
export function seedPresence(store: Store): void {
  store.dispatch({
    type: "gw",
    t: "GUILD_MEMBER_LIST_UPDATE",
    d: { guild_id: "910000000000000001", id: "everyone", member_count: 14814, online_count: 2345, groups: [], ops: [] },
  });
}
