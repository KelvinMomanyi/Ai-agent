// extensions/my-extension/assets/sw.js
self.addEventListener('fetch', (event) => {
    const { request } = event;
  
    if (
      request.method === 'POST' &&
      new URL(request.url).pathname === '/cart/add'
    ) {
      event.respondWith(
        (async () => {
          const cloned = request.clone();
          const body = await cloned.text();
          console.log('Intercepted /cart/add:', body);
  
          return fetch(request);
        })()
      );
    }
  });
  