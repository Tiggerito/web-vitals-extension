/*
 Copyright 2020 Google Inc. All Rights Reserved.
 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at
     http://www.apache.org/licenses/LICENSE-2.0
 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
*/

(async () => {
  const src = chrome.runtime.getURL('node_modules/web-vitals/dist/web-vitals.es5.min.js');
  const webVitals = await import(src);
  let overlayClosedForSession = false;
  let latestCLS = {};
  let layoutShiftCount = 0;
  let enableLogging = localStorage.getItem('web-vitals-extension-debug')=='TRUE';

  // Core Web Vitals thresholds
  const LCP_THRESHOLD = 2500;
  const FID_THRESHOLD = 100;
  const CLS_THRESHOLD = 0.1;

  const LCP_POOR_THRESHOLD = 4000;
  const FID_POOR_THRESHOLD = 300;
  const CLS_POOR_THRESHOLD = 0.25;

  // CLS update frequency
  const DEBOUNCE_DELAY = 500;

  // Registry for badge metrics
  badgeMetrics = {
    lcp: {
      value: 0,
      final: false,
      pass: true,
    },
    cls: {
      value: 0,
      final: false,
      pass: true,
    },
    fid: {
      value: 0,
      final: false,
      pass: true,
    },
  };

  /**
    * Very simple classifier for metrics values
    * @param  {Object} metrics
    * @return {String} overall metrics score
  */
  function scoreBadgeMetrics(metrics) {
    // Note: overallScore is treated as a string rather than
    // a boolean to give us the flexibility of introducing a
    // 'NEEDS IMPROVEMENT' option here in the future.
    let overallScore = 'GOOD';
    if (metrics.lcp.value > LCP_THRESHOLD) {
      overallScore = 'POOR';
      metrics.lcp.pass = false;
    }
    if (metrics.fid.value > FID_THRESHOLD) {
      overallScore = 'POOR';
      metrics.fid.pass = false;
    }
    if (metrics.cls.value > CLS_THRESHOLD) {
      overallScore = 'POOR';
      metrics.cls.pass = false;
    }
    return overallScore;
  }

  /**
     *
     * Draw or update the HUD overlay to the page
     * @param {Object} metrics
     * @param {Number} tabId
     */
  function drawOverlay(metrics, tabId) {
    let tabLoadedInBackground = false;
    const key = tabId.toString();

    // Check if tab was loaded in background
    chrome.storage.local.get(key, (result) => {
      tabLoadedInBackground = result[key];
    });

    // Check for preferences set in options
    chrome.storage.sync.get({
      enableOverlay: false,
      debug: false,
    }, ({
      enableOverlay, debug,
    }) => {
      if (enableOverlay === true && overlayClosedForSession == false) {
        // Overlay
        const overlayElement = document.getElementById('web-vitals-extension-overlay');
        if (overlayElement === null) {
          const overlayElement = document.createElement('div');
          overlayElement.id = 'web-vitals-extension-overlay';
          overlayElement.classList.add('web-vitals-chrome-extension');
          overlayElement.innerHTML = buildOverlayTemplate(metrics, tabLoadedInBackground);
          document.body.appendChild(overlayElement);
        } else {
          overlayElement.innerHTML = buildOverlayTemplate(metrics, tabLoadedInBackground);
        }

        // Overlay close button
        const overlayClose = document.getElementById('web-vitals-close');
        if (overlayClose === null) {
          const overlayClose = document.createElement('button');
          overlayClose.innerText = 'Close';
          overlayClose.id = 'web-vitals-close';
          overlayClose.className = 'lh-overlay-close';
          overlayClose.addEventListener('click', () => {
            overlayElement.remove();
            overlayClose.remove();
            overlayClosedForSession = true;
          });
          document.body.appendChild(overlayClose);
        } else {
          overlayClose.addEventListener('click', () => {
            overlayElement.remove();
            overlayClose.remove();
            overlayClosedForSession = true;
          });
        }
      }
      if (debug) {
        localStorage.setItem('web-vitals-extension-debug', 'TRUE');
        enableLogging = true;
      } else {
        localStorage.removeItem('web-vitals-extension-debug');
        enableLogging = false;
      }
    });
  }

  /**
 * Return a short (host) and full URL for the measured page
 * @return {Object}
 */
  function getURL() {
    const url = document.location.href;
    const shortURL = document.location.origin;
    return {shortURL, url};
  }

  /**
   * Return a short timestamp (HH:MM:SS) for current time
   * @return {String}
   */
  function getTimestamp() {
    const date = new Date();
    return date.toLocaleTimeString('en-US', {hourCycle: 'h23'});
  }

/**
 * Do on page changes based on a CLS event
 */
  function getCLSStatus(layoutShift) {
    let status = 'pass';

    if(layoutShift.value > CLS_POOR_THRESHOLD) {
      status = 'fail';
    }
    else if (layoutShift.value > CLS_THRESHOLD) {
      status = 'average';
    }
    return status;
  }
  function processOnPageCLS(metric) {

    metric.entries.forEach((layoutShift) => {
      let status = getCLSStatus(layoutShift);

      if(!layoutShift.position){
        layoutShiftCount++;
        layoutShift.position = layoutShiftCount;
        layoutShift.sourceCount=0;
      }

      layoutShift.sources.forEach((source) => {
        if(source.node && source.node.classList) {

          if(!source.position){
            layoutShift.sourceCount++;
            source.position = layoutShift.sourceCount;
          }

          if(!source.node.layoutShiftElement) {
            
            source.node.layoutShiftElement = document.createElement('div');

            source.node.layoutShiftElement.style.position = "absolute";
            source.node.layoutShiftElement.style.left = '0px';
            source.node.layoutShiftElement.style.top = '0px';

   
            source.node.appendChild(source.node.layoutShiftElement);

            source.node.layoutShiftSources = [];
          }

          if(!source.node.layoutShiftSources.includes(source)) {
            source.node.layoutShiftSources.push(source);

            let nodeElement = document.createElement('div');

            nodeElement.classList.add('web-vitals-chrome-extension','lh-vars',`layoutshift-${status}`,'layoutshift-node-div',`layoutshift-position-${layoutShift.position}-${source.position}`,`layoutshift-position-${layoutShift.position}`);

            nodeElement.innerHTML = `${layoutShift.position}.${source.position}`;

            source.node.layoutShiftElement.appendChild(nodeElement);
          }

          source.node.classList.remove('cls-pass','cls-average','cls-fail');
          source.node.classList.add('web-vitals-chrome-extension','lh-vars',`layoutshift-${status}`,'layoutshift-node',`layoutshift-position-${layoutShift.position}-${source.position}`,`layoutshift-position-${layoutShift.position}`);

          if(!source.previousElement) {

            if(!source.node.shifts) {
              source.node.shifts=0;
            }

            source.node.shifts++;
          
            source.previousElement = document.createElement('div');

            let previousRect = source.previousRect;

            source.previousElement.classList.add('web-vitals-chrome-extension','lh-vars','layoutshift-previous',`layoutshift-position-${layoutShift.position}-${source.position}`,`layoutshift-position-${layoutShift.position}`);

            source.previousElement.style.position = "absolute";
            source.previousElement.style.left = `${previousRect.left + window.scrollX}px`;
            source.previousElement.style.top = `${previousRect.top + window.scrollY}px`;
            source.previousElement.style.width = `${previousRect.width}px`;
            source.previousElement.style.height = `${previousRect.height}px`;

            source.previousElement.innerHTML = `${layoutShift.position}.${source.position}.${source.node.shifts}`;

            document.body.appendChild(source.previousElement);
          }
        }
      });
    });  
  }

/**
 * Do on page changes based on an LCP event
 */
  function processOnPageLCP(metric) {

  }

  /**
     *
     * Broadcasts metrics updates using chrome.runtime(), triggering
     * updates to the badge. Will also update the overlay if this option
     * is enabled.
     * @param {String} metricName
     * @param {Object} body
     */
  function broadcastMetricsUpdates(metricName, body) {
    if (metricName === undefined || badgeMetrics === undefined) {
      return;
    }
    if (enableLogging) {
      console.log('[Web Vitals]', body.name, body.value.toFixed(2), body);
    }
    badgeMetrics[metricName].value = body.value;
    badgeMetrics[metricName].final = body.isFinal;
    badgeMetrics.location = getURL();
    badgeMetrics.timestamp = getTimestamp();
    const passes = scoreBadgeMetrics(badgeMetrics);
    // Broadcast metrics updates for badging
    chrome.runtime.sendMessage(
        {
          passesAllThresholds: passes,
          metrics: badgeMetrics,
        },
        (response) => drawOverlay(badgeMetrics, response.tabId), // TODO: Once the metrics are final, cache locally.
    );
  }

  /**
   * Broadcasts the latest CLS value
   */
  function broadcastCLS() {
    broadcastMetricsUpdates('cls', latestCLS);
  }

  /**
 * Debounces the broadcast of CLS values for stability.
 * broadcastCLS is invoked on the trailing edge of the
 * DEBOUNCE_DELAY timeout if invoked more than once during
 * the wait timeout.
 */
  let debouncedCLSBroadcast = () => {};
  if (_ !== undefined) {
    debouncedCLSBroadcast = _.debounce(broadcastCLS, DEBOUNCE_DELAY, {
      leading: true,
      trailing: true,
      maxWait: 1000});
  }
  /**
 *
 * Fetches Web Vitals metrics via WebVitals.js
 */
  function fetchWebPerfMetrics() {
    // web-vitals.js doesn't have a way to remove previous listeners, so we'll save whether
    // we've already installed the listeners before installing them again.
    // See https://github.com/GoogleChrome/web-vitals/issues/55.
    if (self._hasInstalledPerfMetrics) return;
    self._hasInstalledPerfMetrics = true;

    webVitals.getCLS((metric) => {
      // As CLS values can fire frequently in the case
      // of animations or highly-dynamic content, we
      // debounce the broadcast of the metric.
      processOnPageCLS(metric);
      latestCLS = metric;
      debouncedCLSBroadcast();
    }, true);
    webVitals.getLCP((metric) => {
      processOnPageLCP(metric);
      broadcastMetricsUpdates('lcp', metric);
    }, true);
    webVitals.getFID((metric) => {
      broadcastMetricsUpdates('fid', metric);
    }, true);
  }
  function buildLayoutShiftListItem(layoutShift) {
    let status = getCLSStatus(layoutShift);

    let sources = layoutShift.sources.map((source) => {
      return `<span onmouseover="document.querySelectorAll('.layoutshift-position-${layoutShift.position}-${source.position}').forEach((e)=>e.classList.add('layoutshift-visible'))" onmouseout="document.querySelectorAll('.layoutshift-position-${layoutShift.position}-${source.position}').forEach((e)=>e.classList.remove('layoutshift-visible'))">${source.position}</span>`;
    }).join();

    return `
      <div class="lh-metric lh-metric--${status}">
        <div class="lh-metric__innerwrap" >
          <div>
            <span class="lh-metric__title" onmouseover="document.querySelectorAll('.layoutshift-position-${layoutShift.position}').forEach((e)=>e.classList.add('layoutshift-visible'))" onmouseout="document.querySelectorAll('.layoutshift-position-${layoutShift.position}').forEach((e)=>e.classList.remove('layoutshift-visible'))">
              Layout Shift${' '}${layoutShift.position}
                </span> (${sources})
          </div>
          <div class="lh-metric__value">${(layoutShift.value).toFixed(3)}&nbsp;</div>
        </div>
      </div>
    `;
  }
  function buildLayoutShiftList() {
    if(!latestCLS) return '';
    let html = '';
    latestCLS.entries.forEach((layoutShift) => {
      html += buildLayoutShiftListItem(layoutShift);
    }); 
    return `<div class="lh-layoutshifts">${html}</div>`;
  }
  /**
 * Build a template of metrics
 * @param {Object} metrics The metrics
 * @param {Boolean} tabLoadedInBackground
 * @return {String} a populated template of metrics
 */
  function buildOverlayTemplate(metrics, tabLoadedInBackground) {
    return `
    <div id="lh-overlay-container" class="lh-unset lh-root lh-vars dark" style="display: block;">
    <div class="lh-overlay">
    <div class="lh-audit-group lh-audit-group--metrics">
    <div class="lh-audit-group__header">
      <span class="lh-audit-group__title">Metrics</span>
    </div>
    <div class="lh-columns">
      <div class="lh-column">
        <div class="lh-metric lh-metric--${metrics.lcp.pass ? 'pass':'fail'}">
          <div class="lh-metric__innerwrap">
            <div>
              <span class="lh-metric__title">
                Largest Contentful Paint${' '}
                  <span class="lh-metric-state">${metrics.lcp.final ? '' : '(might change)'}</span></span>
                  ${tabLoadedInBackground ? '<span class="lh-metric__subtitle">Value inflated as tab was loaded in background</span>' : ''}
            </div>
            <div class="lh-metric__value">${(metrics.lcp.value/1000).toFixed(2)}&nbsp;s</div>
          </div>
        </div>
        <div class="lh-metric lh-metric--${metrics.fid.pass ? 'pass':'fail'}">
          <div class="lh-metric__innerwrap">
            <span class="lh-metric__title">
              First Input Delay${' '}
                <span class="lh-metric-state">${metrics.fid.final ? '' : '(waiting for input)'}</span></span>
            <div class="lh-metric__value">${metrics.fid.final ? `${metrics.fid.value.toFixed(2)}&nbsp;ms` : ''}</div>
          </div>
        </div>
        <div class="lh-metric lh-metric--${metrics.cls.pass ? 'pass':'fail'}">
          <div class="lh-metric__innerwrap">
            <span class="lh-metric__title">
              Cumulative Layout Shift${' '}
                <span class="lh-metric-state">${metrics.cls.final ? '' : '(might change)'}</span></span>
            <div class="lh-metric__value">${metrics.cls.value.toFixed(3)}&nbsp;</div>
          </div>
        </div>
        ${buildLayoutShiftList()}
      </div>
    </div>
  </div>
  </div>
  </div>`;
  }

  fetchWebPerfMetrics();
})();
