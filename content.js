class VisualInspector {
  constructor() {
    this.layers = new Map();
    this.isDragging = false;
    this.currentX = 0;
    this.currentY = 0;
    this.initialX = 0;
    this.initialY = 0;
    this.dragTarget = null;

    this.init();
    this.initKeyboardShortcuts();
  }

  init() {
    // 从storage中恢复状态
    chrome.storage.local.get(['layers'], (result) => {
      if (result.layers) {
        result.layers.forEach(layer => {
          this.createLayer(layer);
        });
      }
    });
  }

  createLayer(layerData) {
    const container = document.createElement('div');
    container.className = 'visual-inspector-layer';
    container.id = `layer-${layerData.id}`;
    
    // 创建图片容器
    const imageContainer = document.createElement('div');
    imageContainer.className = 'image-container';
    
    const img = new Image();
    img.src = layerData.imageData;
    img.style.width = '100%';
    img.style.height = 'auto';
    img.style.pointerEvents = 'none';
    
    imageContainer.appendChild(img);
    
    // 添加缩放手柄到图片容器
    const handlePositions = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 
                           'top', 'right', 'bottom', 'left'];
    
    handlePositions.forEach(position => {
      const handle = document.createElement('div');
      handle.className = `resize-handle ${position}`;
      imageContainer.appendChild(handle);
      this.setupResizeHandleEvents(handle, container, position);
    });
    
    // 创建控制面板
    const controls = document.createElement('div');
    controls.className = 'layer-controls';
    
    // 透明度控制
    const opacityGroup = document.createElement('div');
    opacityGroup.className = 'control-group';
    
    const opacityLabel = document.createElement('label');
    opacityLabel.textContent = '透明度';
    
    const opacityInput = document.createElement('input');
    opacityInput.type = 'range';
    opacityInput.min = '0';
    opacityInput.max = '100';
    opacityInput.value = (layerData.opacity || 1) * 100;
    
    const opacityValue = document.createElement('span');
    opacityValue.className = 'control-value';
    opacityValue.textContent = Math.round((layerData.opacity || 1) * 100) + '%';
    
    opacityGroup.appendChild(opacityLabel);
    opacityGroup.appendChild(opacityInput);
    opacityGroup.appendChild(opacityValue);
    
    // 删除按钮
    const deleteButton = document.createElement('button');
    deleteButton.className = 'layer-delete';
    deleteButton.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z"/></svg>';
    deleteButton.title = '删除图层';
    
    controls.appendChild(opacityGroup);
    controls.appendChild(deleteButton);
    
    // 事件处理
    opacityInput.addEventListener('input', (e) => {
      const opacity = parseFloat(e.target.value) / 100;
      opacityValue.textContent = Math.round(opacity * 100) + '%';
      imageContainer.style.opacity = opacity;
      
      // 更新存储的数据
      const layer = this.layers.get(layerData.id);
      layer.data.opacity = opacity;
      this.saveLayerState(layerData.id, layer.data);
    });
    
    deleteButton.addEventListener('click', () => {
      if (confirm('确定要删除这个图层吗？')) {
        container.remove();
        this.layers.delete(layerData.id);
        chrome.storage.local.get(['layers'], (result) => {
          const layers = result.layers || [];
          const updatedLayers = layers.filter(layer => layer.id !== layerData.id);
          chrome.storage.local.set({ layers: updatedLayers });
        });
      }
    });
    
    // 防止控制面板的点击触发拖动
    controls.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
    
    controls.addEventListener('touchstart', (e) => {
      e.stopPropagation();
    });
    
    container.appendChild(imageContainer);
    container.appendChild(controls);
    document.body.appendChild(container);
    
    // 设置初始显示状态
    container.style.display = layerData.visible ? 'block' : 'none';
    
    // 设置初始transform和opacity
    this.updateLayerTransform(container, {
      ...layerData,
      position: layerData.position || { x: 0, y: 0 },
      scale: layerData.scale || 1,
      opacity: layerData.opacity || 1
    });
    
    this.setupLayerEvents(imageContainer);
    
    this.layers.set(layerData.id, {
      element: container,
      data: layerData
    });
    
    img.onload = () => {
      console.log('Image loaded successfully:', layerData.id);
    };
    
    img.onerror = (error) => {
      console.error('Error loading image:', error);
    };
  }

  updateLayerTransform(element, layerData) {
    element.style.transform = `translate(${layerData.position.x}px, ${layerData.position.y}px) scale(${layerData.scale})`;
    const imageContainer = element.querySelector('.image-container');
    if (imageContainer) {
      imageContainer.style.opacity = layerData.opacity;
    }
  }

  scaleLayer(element, newScale, centerX, centerY) {
    const layerId = element.id.replace('layer-', '');
    const layer = this.layers.get(layerId);
    if (!layer) return;

    const rect = element.getBoundingClientRect();
    const oldScale = layer.data.scale;
    
    // 计算鼠标相对于元素的位置比例
    const relativeX = (centerX - rect.left) / rect.width;
    const relativeY = (centerY - rect.top) / rect.height;
    
    // 计算缩放导致的尺寸变化
    const scaleDiff = newScale - oldScale;
    const deltaX = rect.width * scaleDiff * relativeX;
    const deltaY = rect.height * scaleDiff * relativeY;
    
    // 更新位置，补偿缩放导致的偏移
    layer.data.position.x -= deltaX;
    layer.data.position.y -= deltaY;
    layer.data.scale = newScale;
    
    // 应用变换
    this.updateLayerTransform(element, layer.data);
    
    // 保存状态
    this.saveLayerState(layerId, layer.data);
  }

  setupLayerEvents(element) {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialX = 0;
    let initialY = 0;

    // 移除其他图层的active状态
    const removeActiveFromOthers = () => {
      this.layers.forEach(layer => {
        if (layer.element !== element.parentNode) {
          layer.element.classList.remove('active');
        }
      });
    };

    // 点击事件处理
    element.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // 只响应左键
      
      // 如果点击的是控制面板或resize手柄，不切换active状态
      if (e.target.closest('.layer-controls') || e.target.closest('.resize-handle')) {
        return;
      }

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const transform = new WebKitCSSMatrix(window.getComputedStyle(element.parentNode).transform);
      initialX = transform.m41;
      initialY = transform.m42;
      element.parentNode.style.cursor = 'grabbing';

      // 切换active状态
      removeActiveFromOthers();
      element.parentNode.classList.add('active');

      e.preventDefault();
    });

    // 触摸事件处理
    element.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return; // 只处理单指触摸

      // 如果点击的是控制面板或resize手柄，不切换active状态
      if (e.target.closest('.layer-controls') || e.target.closest('.resize-handle')) {
        return;
      }

      isDragging = true;
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      const transform = new WebKitCSSMatrix(window.getComputedStyle(element.parentNode).transform);
      initialX = transform.m41;
      initialY = transform.m42;

      // 切换active状态
      removeActiveFromOthers();
      element.parentNode.classList.add('active');

      e.preventDefault();
    }, { passive: false });

    // 添加点击其他区域移除active状态的处理
    document.addEventListener('mousedown', (e) => {
      if (!element.parentNode.contains(e.target)) {
        element.parentNode.classList.remove('active');
      }
    });

    document.addEventListener('touchstart', (e) => {
      if (!element.parentNode.contains(e.target)) {
        element.parentNode.classList.remove('active');
      }
    }, { passive: true });

    // 鼠标事件
    element.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // 只响应左键
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const transform = new WebKitCSSMatrix(window.getComputedStyle(element.parentNode).transform);
      initialX = transform.m41;
      initialY = transform.m42;
      element.parentNode.style.cursor = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const newX = initialX + dx;
      const newY = initialY + dy;
      this.updateLayerPosition(element.parentNode, { x: newX, y: newY });
      e.preventDefault();
    });

    document.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      element.parentNode.style.cursor = 'grab';
    });

    // 触摸事件
    element.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return; // 只处理单指触摸
      isDragging = true;
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      const transform = new WebKitCSSMatrix(window.getComputedStyle(element.parentNode).transform);
      initialX = transform.m41;
      initialY = transform.m42;
      e.preventDefault(); // 防止滚动
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
      if (!isDragging || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      const newX = initialX + dx;
      const newY = initialY + dy;
      this.updateLayerPosition(element.parentNode, { x: newX, y: newY });
      e.preventDefault(); // 防止滚动
    }, { passive: false });

    document.addEventListener('touchend', () => {
      isDragging = false;
    });

    document.addEventListener('touchcancel', () => {
      isDragging = false;
    });

    // 缩放事件
    element.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY * -0.01;
        const currentTransform = new WebKitCSSMatrix(window.getComputedStyle(element.parentNode).transform);
        const currentScale = currentTransform.a;
        const newScale = Math.max(0.1, Math.min(10, currentScale * (1 + delta)));
        
        // 获取鼠标相对于图层的位置
        const rect = element.parentNode.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        // 计算新的位置，保持鼠标指向的点不变
        const scaleRatio = newScale / currentScale;
        const dx = mouseX * (1 - scaleRatio);
        const dy = mouseY * (1 - scaleRatio);
        
        const newX = currentTransform.m41 + dx;
        const newY = currentTransform.m42 + dy;
        
        this.updateLayerTransform(element.parentNode, {
          scale: newScale,
          position: { x: newX, y: newY }
        });
      }
    }, { passive: false });

    // 添加双指缩放支持
    let initialDistance = 0;
    let initialScale = 1;

    element.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        initialDistance = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const transform = new WebKitCSSMatrix(window.getComputedStyle(element.parentNode).transform);
        initialScale = transform.a;
        e.preventDefault();
      }
    }, { passive: false });

    element.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        const currentDistance = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        
        const scale = (currentDistance / initialDistance) * initialScale;
        const newScale = Math.max(0.1, Math.min(10, scale));
        
        // 计算缩放中心点
        const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        
        const transform = new WebKitCSSMatrix(window.getComputedStyle(element.parentNode).transform);
        const currentScale = transform.a;
        
        // 保持缩放中心点不变
        const scaleRatio = newScale / currentScale;
        const rect = element.parentNode.getBoundingClientRect();
        const dx = (centerX - rect.left) * (1 - scaleRatio);
        const dy = (centerY - rect.top) * (1 - scaleRatio);
        
        this.updateLayerTransform(element.parentNode, {
          scale: newScale,
          position: { 
            x: transform.m41 + dx,
            y: transform.m42 + dy
          }
        });
        
        e.preventDefault();
      }
    }, { passive: false });
  }

  setupResizeHandleEvents(handle, element, position) {
    let isResizing = false;
    let startX = 0;
    let startY = 0;
    let startWidth = 0;
    let startHeight = 0;
    let startTransform;
    
    const onStart = (clientX, clientY) => {
      isResizing = true;
      element.classList.add('resizing');
      
      startX = clientX;
      startY = clientY;
      const rect = element.getBoundingClientRect();
      startWidth = rect.width;
      startHeight = rect.height;
      startTransform = new WebKitCSSMatrix(window.getComputedStyle(element).transform);
      
      // 阻止事件冒泡，防止触发拖动
      return false;
    };
    
    const onMove = (clientX, clientY) => {
      if (!isResizing) return;
      
      const deltaX = clientX - startX;
      const deltaY = clientY - startY;
      let newScale = 1;
      
      // 根据不同的调整手柄位置计算缩放
      switch (position) {
        case 'top-left':
          newScale = Math.max(0.1, (startWidth - deltaX) / startWidth);
          break;
        case 'top-right':
          newScale = Math.max(0.1, (startWidth + deltaX) / startWidth);
          break;
        case 'bottom-left':
          newScale = Math.max(0.1, (startWidth - deltaX) / startWidth);
          break;
        case 'bottom-right':
          newScale = Math.max(0.1, (startWidth + deltaX) / startWidth);
          break;
        case 'left':
        case 'right':
          newScale = Math.max(0.1, (startWidth + (position === 'right' ? deltaX : -deltaX)) / startWidth);
          break;
        case 'top':
        case 'bottom':
          newScale = Math.max(0.1, (startHeight + (position === 'bottom' ? deltaY : -deltaY)) / startHeight);
          break;
      }
      
      // 计算新的位置，保持图层锚点不变
      const rect = element.getBoundingClientRect();
      let anchorX = 0, anchorY = 0;
      
      // 根据调整手柄的位置确定锚点
      if (position.includes('right')) anchorX = 0;
      else if (position.includes('left')) anchorX = rect.width;
      else anchorX = rect.width / 2;
      
      if (position.includes('bottom')) anchorY = 0;
      else if (position.includes('top')) anchorY = rect.height;
      else anchorY = rect.height / 2;
      
      const scaleChange = newScale / (startTransform.a || 1);
      const newX = startTransform.m41 - (scaleChange - 1) * anchorX;
      const newY = startTransform.m42 - (scaleChange - 1) * anchorY;
      
      element.style.transform = `translate(${newX}px, ${newY}px) scale(${newScale})`;
      
      // 更新图层数据
      const layerId = element.id.replace('layer-', '');
      const layer = this.layers.get(layerId);
      if (layer) {
        layer.data.scale = newScale;
        layer.data.position = { x: newX, y: newY };
        this.saveLayerState(layerId, layer.data);
      }
    };
    
    const onEnd = () => {
      if (isResizing) {
        isResizing = false;
        element.classList.remove('resizing');
      }
    };
    
    // 鼠标事件
    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      onStart(e.clientX, e.clientY);
    });
    
    document.addEventListener('mousemove', (e) => {
      if (isResizing) {
        e.preventDefault();
        onMove(e.clientX, e.clientY);
      }
    });
    
    document.addEventListener('mouseup', onEnd);
    
    // 触摸事件
    handle.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        e.stopPropagation();
        const touch = e.touches[0];
        onStart(touch.clientX, touch.clientY);
      }
    }, { passive: false });
    
    document.addEventListener('touchmove', (e) => {
      if (isResizing && e.touches.length === 1) {
        e.preventDefault();
        const touch = e.touches[0];
        onMove(touch.clientX, touch.clientY);
      }
    }, { passive: false });
    
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
  }

  updateLayerPosition(element, position) {
    const layerId = element.id.replace('layer-', '');
    const layer = this.layers.get(layerId);
    layer.data.position = position;
    this.updateLayerTransform(element, layer.data);
    this.saveLayerState(layerId, layer.data);
  }

  dragStart(e) {
    if (this.layers.size > 0) return;

    this.dragTarget = e.currentTarget;
    const layerId = this.dragTarget.id.replace('layer-', '');
    const layer = this.layers.get(layerId);
    
    this.initialX = e.clientX - layer.data.position.x;
    this.initialY = e.clientY - layer.data.position.y;
    this.isDragging = true;
  }

  drag(e) {
    if (!this.isDragging || !this.dragTarget) return;
    e.preventDefault();

    const layerId = this.dragTarget.id.replace('layer-', '');
    const layer = this.layers.get(layerId);
    
    layer.data.position.x = e.clientX - this.initialX;
    layer.data.position.y = e.clientY - this.initialY;
    
    this.updateLayerTransform(this.dragTarget, layer.data);
    this.saveLayerState(layerId, layer.data);
  }

  dragEnd() {
    this.isDragging = false;
    this.dragTarget = null;
  }

  handleWheel(e) {
    if (!e.ctrlKey || this.layers.size > 0) return;
    e.preventDefault();
    
    const layerId = e.currentTarget.id.replace('layer-', '');
    const layer = this.layers.get(layerId);
    
    const delta = e.deltaY * -0.01;
    layer.data.scale = Math.min(Math.max(0.1, layer.data.scale + delta), 2);
    
    this.updateLayerTransform(e.currentTarget, layer.data);
    this.saveLayerState(layerId, layer.data);
  }

  saveLayerState(layerId, layerData) {
    const layers = Array.from(this.layers.values()).map(l => l.data);
    chrome.storage.local.set({ layers });
  }

  initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
    });
  }
}

// 创建Visual Inspector实例
const visualInspector = new VisualInspector();

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'ADD_LAYER':
      visualInspector.createLayer(message.layer);
      break;
    case 'REMOVE_LAYER':
      const layer = visualInspector.layers.get(message.layerId);
      if (layer) {
        layer.element.remove();
        visualInspector.layers.delete(message.layerId);
      }
      break;
    case 'TOGGLE_LAYER_VISIBILITY':
      const toggleLayer = visualInspector.layers.get(message.layerId);
      if (toggleLayer) {
        const isVisible = toggleLayer.element.style.display !== 'none';
        toggleLayer.element.style.display = isVisible ? 'none' : 'block';
        toggleLayer.data.visible = !isVisible;
        visualInspector.saveLayerState(message.layerId, toggleLayer.data);
      }
      break;
    case 'UPDATE_OPACITY':
      const opacityLayer = visualInspector.layers.get(message.layerId);
      if (opacityLayer) {
        opacityLayer.data.opacity = message.value / 100;
        visualInspector.updateLayerTransform(opacityLayer.element, opacityLayer.data);
      }
      break;
    case 'UPDATE_SCALE':
      const scaleLayer = visualInspector.layers.get(message.layerId);
      if (scaleLayer) {
        scaleLayer.data.scale = message.value / 100;
        visualInspector.updateLayerTransform(scaleLayer.element, scaleLayer.data);
      }
      break;
  }
});
