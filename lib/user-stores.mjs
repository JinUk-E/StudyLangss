import { resolve } from 'node:path';
import { mkdirSync, chmodSync } from 'node:fs';
import { assert } from './validation.mjs';

/** A stable store per immutable account ID; owner keeps the original directory. */
export function createUserStores(directory, create, filename) {
  const stores = new Map([['owner', create(directory)]]);
  let closed = false;
  return {
    owner: stores.get('owner'),
    get(user) {
      assert(!closed, '저장소가 종료되었습니다.', 503);
      const id = user?.id;
      assert(id === 'owner' || typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id), '계정 정보를 확인하세요.', 403);
      if (!stores.has(id)) {
        const path = resolve(directory, 'users', id);
        mkdirSync(path, { recursive: true, mode: 0o700 });
        const store = create(path);
        chmodSync(resolve(path, filename), 0o600);
        stores.set(id, store);
      }
      return stores.get(id);
    },
    close() {
      if (closed) return;
      closed = true;
      for (const store of stores.values()) store.db.close();
      stores.clear();
    }
  };
}
