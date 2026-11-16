const html = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function renderNextCartPage(
  product: Record<string, any>,
  offerId: string,
) {
  const variants = (
    Array.isArray(product.variants) ? product.variants : []
  ).filter(
    (v: any) =>
      v.availableForSale && /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(v.id),
  );
  if (!variants.length) throw new Error("No available variants");
  if (!/^[a-zA-Z0-9-]+$/.test(product.handle || ""))
    throw new Error("Invalid product handle");
  const data = JSON.stringify({
    offerId,
    handle: product.handle,
    variants: variants.map((v: any) => String(v.id).split("/").pop()),
  }).replace(/</g, "\\u003c");
  return `<section id="aovboost-next-cart" style="max-width:640px;padding:24px;margin:24px auto">
    <h1>For your next cart</h1><p>Your completed order stays as placed. This product will be added to your current shopping cart.</p>
    <h2>${html(product.title)}</h2>
    <form><label for="aovboost-next-variant">Variant and price</label><select id="aovboost-next-variant" name="variant" disabled></select>
    <label for="aovboost-next-quantity">Quantity</label><input id="aovboost-next-quantity" name="quantity" type="number" min="1" max="10" value="1" required>
    <button type="submit" disabled>Add to cart</button><button type="button" data-retry hidden>Retry product details</button><p role="status" aria-live="polite">Checking current options and prices…</p></form><a href="{{ routes.cart_url }}">Review cart</a> <a href="{{ routes.root_url }}products/${html(product.handle)}">View product</a>
  </section><script>(function(){
    const root=document.getElementById('aovboost-next-cart'),form=root.querySelector('form'),button=form.querySelector('[type=submit]'),retry=form.querySelector('[data-retry]'),select=form.elements.variant,status=form.querySelector('[role=status]'),data=${data},base=window.Shopify?.routes?.root||'/';
    let added=false;
    async function details(){
      retry.hidden=true;button.disabled=true;select.disabled=true;
      try{
        const [productResponse,cartResponse]=await Promise.all([fetch(base+'products/'+encodeURIComponent(data.handle)+'.js',{cache:'no-store'}),fetch(base+'cart.js',{cache:'no-store'})]);
        if(!productResponse.ok||!cartResponse.ok)throw new Error('details');
        const product=await productResponse.json(),cart=await cartResponse.json();
        const money=new Intl.NumberFormat(document.documentElement.lang||undefined,{style:'currency',currency:cart.currency});
        const options=(product.variants||[]).filter(v=>v.available&&data.variants.includes(String(v.id))&&Number.isFinite(v.price));
        if(!options.length)throw new Error('unavailable');
        select.replaceChildren(...options.map(v=>{const option=document.createElement('option');option.value=String(v.id);option.textContent=v.title+' — '+money.format(v.price/100);return option;}));
        select.disabled=false;button.disabled=false;status.textContent='';
      }catch{status.textContent='Current options are unavailable. Retry or view the product.';retry.hidden=false;}
    }
    retry.addEventListener('click',()=>void details());void details();
    form.addEventListener('submit',async function(event){
      event.preventDefault();if(button.disabled)return;
      if(added){location.assign(base+'cart');return;}
      const quantity=Number(form.elements.quantity.value),id=select.value;
      if(!Number.isInteger(quantity)||quantity<1||quantity>10||!/^\\d+$/.test(id))return;
      button.disabled=true;status.textContent='Adding to your cart…';
      try{
        const properties={_aovboost_offer_id:data.offerId};
        const sid=window.AOVBoostSDK?.sessionId;
        if(typeof sid==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(sid))properties._aovboost_session_id=sid;
        const response=await fetch(base+'cart/add.js',{method:'POST',headers:{'Content-Type':'application/json','X-AOVBoost-Source':'aov_postadd'},body:JSON.stringify({id,quantity,properties})});
        if(!response.ok)throw new Error('add');
        added=true;status.textContent='Added to your cart.';button.textContent='Review cart';
        const cart=await fetch(base+'cart.js',{cache:'no-store'});
        if(!cart.ok)throw new Error('refresh');await cart.json();
        document.dispatchEvent(new CustomEvent('aovboost:cart-mutation',{detail:{type:'add_to_cart',variantId:id,quantity,confirmed:true,mutationId:'postadd-'+Date.now(),recommendationOrigin:true,source:'verified_fetch_response',cartSource:'aov_postadd',offerId:data.offerId}}));
        location.assign(base+'cart');
      }catch{status.textContent=added?'Added to your cart. Review your cart to continue.':'Could not add this item. Please try again.';}
      finally{button.disabled=false;}
    });
  })();</script>`;
}
