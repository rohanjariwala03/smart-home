import * as SecureStore from 'expo-secure-store';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Pressable } from 'react-native';

import { SHARED_KEYCHAIN } from '@/ha';
import { useTheme } from '@/hooks/use-theme';

// Entity ids pinned to the Home tab (devices, cameras, scenes), in the order they were starred.
// Kept on this phone only. One shared copy so every screen updates together. A copy in the shared keychain
// ('ha-favourites') feeds the widget, Siri's device list and the watch (HA.favourites() in targets/widget/_shared).
const KEY = 'favourites';
let favs: string[] | undefined;
const listeners = new Set<(f: string[]) => void>();
const share = (list: string[]) =>
  SecureStore.setItemAsync('ha-favourites', JSON.stringify(list), SHARED_KEYCHAIN).catch(() => {});
const loaded = SecureStore.getItemAsync(KEY).then((v) => {
  favs = v ? JSON.parse(v) : [];
  share(favs!);
  return favs!;
});

export function useFavourites() {
  const [list, setList] = useState(favs);
  useEffect(() => {
    listeners.add(setList);
    loaded.then(setList);
    return () => void listeners.delete(setList);
  }, []);
  const save = (next: string[]) => {
    favs = next;
    listeners.forEach((l) => l(next));
    SecureStore.setItemAsync(KEY, JSON.stringify(next));
    share(next);
  };
  const toggle = (id: string) => save(list?.includes(id) ? list.filter((f) => f !== id) : [...(list ?? []), id]);
  return { favourites: list, isFavourite: (id: string) => !!list?.includes(id), toggle, save };
}

export function FavouriteStar({ on, size = 22 }: { on: boolean; size?: number }) {
  const theme = useTheme();
  return <SymbolView name={on ? 'star.fill' : 'star'} size={size} tintColor={on ? '#FFCC00' : theme.textSecondary} />;
}

/** Star button for a sheet or card header. */
export function FavouriteButton({ entityId }: { entityId: string }) {
  const { isFavourite, toggle } = useFavourites();
  const on = isFavourite(entityId);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={on ? 'Remove from Home' : 'Add to Home'}
      hitSlop={12}
      onPress={() => toggle(entityId)}>
      <FavouriteStar on={on} />
    </Pressable>
  );
}
