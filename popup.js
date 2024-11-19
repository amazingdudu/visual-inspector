document.addEventListener('DOMContentLoaded', () => {
  const uploadBtn = document.getElementById('uploadBtn');
  const imageUpload = document.getElementById('imageUpload');
  const layersList = document.getElementById('layersList');
  const opacitySlider = document.getElementById('opacity');
  const scaleSlider = document.getElementById('scale');
  const opacityValue = document.getElementById('opacityValue');
  const scaleValue = document.getElementById('scaleValue');
  const status = document.getElementById('status');

  // 初始化状态
  let activeLayer = null;
  let layers = [];

  // 从storage中恢复状态
  chrome.storage.local.get(['layers', 'activeLayer'], (result) => {
    if (result.layers) {
      layers = result.layers;
      activeLayer = result.activeLayer;
      updateLayersList();
      updateControls();
    }
  });

  // 监听文件上传
  uploadBtn.addEventListener('click', () => {
    imageUpload.click();
  });

  imageUpload.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) {
      status.textContent = 'No file selected.';
      return;
    }

    if (!file.type.startsWith('image/')) {
      status.textContent = 'Please select an image file.';
      return;
    }

    status.textContent = 'Reading file...';

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const imageData = e.target.result;
        console.log('Image read successfully, size:', imageData.length);

        const newLayer = {
          id: Date.now().toString(),
          name: file.name,
          imageData: imageData,
          visible: true,
          opacity: 1,
          scale: 1,
          position: { x: 0, y: 0 }
        };
        
        layers.push(newLayer);
        activeLayer = newLayer.id;
        
        // 保存到storage
        chrome.storage.local.set({ 
          layers: layers,
          activeLayer: activeLayer
        }, () => {
          if (chrome.runtime.lastError) {
            console.error('Error saving to storage:', chrome.runtime.lastError);
            status.textContent = 'Error saving layer data.';
            return;
          }
          console.log('Layer data saved to storage');
        });
        
        updateLayersList();
        updateControls();
        
        // 发送消息给content script
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) {
          throw new Error('No active tab found');
        }

        console.log('Sending message to content script:', {
          type: 'ADD_LAYER',
          layerId: newLayer.id
        });

        chrome.tabs.sendMessage(tab.id, {
          type: 'ADD_LAYER',
          layer: newLayer
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('Error sending message:', chrome.runtime.lastError);
            status.textContent = 'Error communicating with page.';
            return;
          }
          console.log('Message sent successfully');
          status.textContent = 'Layer added successfully!';
        });
      } catch (error) {
        console.error('Error processing image:', error);
        status.textContent = 'Error processing image.';
      }
    };
    
    reader.onerror = (error) => {
      console.error('Error reading file:', error);
      status.textContent = 'Error reading the file.';
    };

    try {
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Error starting file read:', error);
      status.textContent = 'Error reading the file.';
    }
  });

  // 更新图层列表UI
  function updateLayersList() {
    layersList.innerHTML = '';
    layers.forEach(layer => {
      const layerItem = document.createElement('div');
      layerItem.className = 'layer-item';
      if (layer.id === activeLayer) {
        layerItem.style.borderLeft = '3px solid #4CAF50';
      }
      
      const visibility = document.createElement('span');
      visibility.className = 'layer-visibility';
      visibility.innerHTML = layer.visible ? '👁️' : '👁️‍🗨️';
      visibility.onclick = async () => {
        layer.visible = !layer.visible;
        updateLayersList();
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        chrome.tabs.sendMessage(tab.id, {
          type: 'UPDATE_LAYER_VISIBILITY',
          layerId: layer.id,
          visible: layer.visible
        });
        chrome.storage.local.set({ layers: layers });
      };
      
      const name = document.createElement('span');
      name.className = 'layer-name';
      name.textContent = layer.name;
      name.onclick = () => {
        activeLayer = layer.id;
        updateLayersList();
        updateControls();
        chrome.storage.local.set({ activeLayer: activeLayer });
      };
      
      const remove = document.createElement('span');
      remove.className = 'layer-remove';
      remove.innerHTML = '×';
      remove.onclick = async () => {
        layers = layers.filter(l => l.id !== layer.id);
        if (activeLayer === layer.id) {
          activeLayer = layers.length > 0 ? layers[layers.length - 1].id : null;
        }
        updateLayersList();
        updateControls();
        
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        chrome.tabs.sendMessage(tab.id, {
          type: 'REMOVE_LAYER',
          layerId: layer.id
        });
        
        chrome.storage.local.set({ 
          layers: layers,
          activeLayer: activeLayer
        });
      };
      
      layerItem.appendChild(visibility);
      layerItem.appendChild(name);
      layerItem.appendChild(remove);
      layersList.appendChild(layerItem);
    });
  }

  // 更新控制器状态
  function updateControls() {
    const layer = layers.find(l => l.id === activeLayer);
    if (layer) {
      opacitySlider.value = layer.opacity * 100;
      scaleSlider.value = layer.scale * 100;
      opacityValue.textContent = Math.round(layer.opacity * 100) + '%';
      scaleValue.textContent = Math.round(layer.scale * 100) + '%';
    }
  }

  // 透明度滑块变化事件
  opacitySlider.addEventListener('input', async () => {
    const value = opacitySlider.value;
    opacityValue.textContent = value + '%';
    
    if (activeLayer) {
      const layer = layers.find(l => l.id === activeLayer);
      if (layer) {
        layer.opacity = value / 100;
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        chrome.tabs.sendMessage(tab.id, {
          type: 'UPDATE_LAYER_OPACITY',
          layerId: activeLayer,
          value: value / 100
        });
        chrome.storage.local.set({ layers: layers });
      }
    }
  });

  // 缩放滑块变化事件
  scaleSlider.addEventListener('input', async () => {
    const value = scaleSlider.value;
    scaleValue.textContent = value + '%';
    
    if (activeLayer) {
      const layer = layers.find(l => l.id === activeLayer);
      if (layer) {
        layer.scale = value / 100;
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        chrome.tabs.sendMessage(tab.id, {
          type: 'UPDATE_LAYER_SCALE',
          layerId: activeLayer,
          value: value / 100
        });
        chrome.storage.local.set({ layers: layers });
      }
    }
  });
});
