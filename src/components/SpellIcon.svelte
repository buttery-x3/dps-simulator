<script>
  import {drawSpellIcon} from '../lib/icons.js';
  let {id, size = 160, state = {}, class: className = '', ...rest} = $props();
  let canvas;

  $effect(() => {
    const context = canvas?.getContext('2d');
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, size, size);
    drawSpellIcon(context, id, 0, 0, size, state);
  });
</script>

<canvas bind:this={canvas} width={size} height={size} class={className} aria-hidden="true" {...rest}></canvas>
