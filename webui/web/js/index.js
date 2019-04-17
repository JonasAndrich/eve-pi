'use strict';

loadScript('js/components/component.js');
loadScript('js/components/abstract_input.js');
loadScript('js/components/checkbox.js');
loadScript('js/components/textfield.js');
loadScript('js/components/combobox.js');
loadScript('js/components/file_upload.js');
loadScript('js/components/log_panel.js');
loadScript('js/script/script-controller.js');
loadScript('js/script/script-view.js');
loadScript('js/script/script-execution-model.js');


var selectedScript = null;
var scriptSelectionListeners = [];
var scriptMenuItems = new Hashtable();
var runningScriptExecutors = [];
var activeScriptController = null;

function onLoad() {
    authorizedCallHttp('conf/title', null, 'GET', function (result) {
        if (result) {
            document.title = result;
        }
    });

    var response = authorizedCallHttp("scripts/list");

    var scripts = JSON.parse(response);

    var scriptsListElement = document.getElementById("scripts");

    scripts.sort(function (name1, name2) {
        return name1.toLowerCase().localeCompare(name2.toLowerCase());
    });

    var scriptHashes = new Hashtable();

    scripts.forEach(function (script) {
        var scriptElement = document.createElement("a");

        var scriptHash = script.replace(/\s/g, "_");
        scriptHashes.put(scriptHash, script);

        addClass(scriptElement, "collection-item");
        addClass(scriptElement, "waves-effect");
        addClass(scriptElement, "waves-teal");
        scriptElement.setAttribute("href", "#" + scriptHash);
        scriptElement.innerText = script;

        scriptSelectionListeners.push(function (activeScript) {
            if (activeScript === script) {
                addClass(scriptElement, "active");
            } else {
                removeClass(scriptElement, "active");
            }
        });

        var stateElement = createTemplateElement('menu-item-state-template');
        scriptElement.appendChild(stateElement);

        scriptsListElement.appendChild(scriptElement);

        scriptElement.stateElement = stateElement;
        scriptMenuItems.put(script, scriptElement);

        updateMenuItemState(script);
    });

    var contentPanel = document.getElementById('content-panel');
    hide(contentPanel);

    scriptSelectionListeners.push(function (activeScript) {
        showScript(activeScript)
    });

    var activateScriptFromHash = function () {
        var hash = getHash();

        if (isNull(hash)) {
            selectScript(null);
            return;
        }

        var scriptName = scriptHashes.get(hash);
        if (isNull(scriptName)) {
            scriptName = hash;
        }

        if (scripts.indexOf(scriptName) !== -1) {
            selectScript(scriptName);
        }
    };
    window.addEventListener('hashchange', activateScriptFromHash);
    activateScriptFromHash();

    window.addEventListener("beforeunload", function (e) {
        if (getUnfinishedExecutors().length > 0) {
            e = e || window.event;

            // in modern browsers the message will be replaced with default one (security reasons)
            var message = "Closing the page will stop all running scripts. Are you sure?";
            e.returnValue = message;

            return message;
        }
    });


    initSearchPanel();

    initLogoutPanel();
    initWelcomeIcon();

    loadActiveExecutions();
}


function loadActiveExecutions() {
    authorizedCallHttp('scripts/execution/active', null, null, function (response) {
        var activeExecutionIds = JSON.parse(response);
        for (var i = 0; i < activeExecutionIds.length; i++) {
            var executionId = activeExecutionIds[i];
            restoreExecutor(executionId, function (executor) {
                addRunningExecutor(executor);

                if (selectedScript === executor.scriptName) {
                    selectScript(executor.scriptName);
                }
            });
        }
    });
}

function initSearchPanel() {
    var scriptsListElement = document.getElementById("scripts");
    var searchPanel = document.getElementById("searchPanel");
    var searchField = document.getElementById("searchField");
    var searchButton = document.getElementById("searchButton");

    var originalSrc = searchButton.src;

    var openSearchOnTheNextClick = true;

    searchField.disabled = true;

    searchField.addEventListener("transitionend", function (e) {
        if ((e.propertyName === "width") && hasClass(searchField, "collapsed")) {
            searchField.disabled = true;
        }
    });

    searchField.addEventListener('input', function () {
        var searchValue = searchField.value;
        for (var i = 0; i < scriptsListElement.childElementCount; ++i) {
            var scriptElement = scriptsListElement.children[i];
            if (scriptElement.innerHTML.toLowerCase().search(searchValue.toLowerCase()) !== -1) {
                show(scriptElement);
            } else {
                hide(scriptElement);
            }
        }
    });

    searchButton.addEventListener("click", function () {
        if (openSearchOnTheNextClick) {
            removeClass(searchField, "collapsed");
            searchField.disabled = false;
            searchField.focus();
            searchButton.src = "images/clear.png";

        } else {
            addClass(searchField, "collapsed");
            searchButton.src = originalSrc;
            searchField.value = "";
            for (var i = 0; i < scriptsListElement.childElementCount; ++i) {
                show(scriptsListElement.children[i]);
            }
        }
        openSearchOnTheNextClick = true;
    });

    searchButton.addEventListener("mousedown", function () {
        openSearchOnTheNextClick = hasClass(searchField, "collapsed");
    });

    searchField.addEventListener("blur", function () {
        var searchValue = searchField.value;
        if (searchValue === "") {
            addClass(searchField, "collapsed");
            searchButton.src = originalSrc;
        }
    });
}

function getUnfinishedExecutors() {
    var unfinishedExecutors = [];
    runningScriptExecutors.forEach(function (executor) {
        if (!executor.isFinished()) {
            unfinishedExecutors.push(executor);
        }
    });
    return unfinishedExecutors;
}

function stopRunningScripts() {
    if (runningScriptExecutors.length > 0) {
        var unfinishedExecutors = getUnfinishedExecutors();

        if (unfinishedExecutors.length > 0) {
            var message;
            if (unfinishedExecutors.length === 1) {
                message = 'Some script is running. Do you want to abort it?'
            } else {
                message = unfinishedExecutors.length + ' scripts are running. Do you want to abort them?'
            }

            var abort = confirm(message);
            if (abort === true) {
                unfinishedExecutors.forEach(function (executor) {
                    executor.abort();
                });
            } else {
                return false;
            }
        }

        clearArray(runningScriptExecutors);
    }

    return true;
}

function initLogoutPanel() {
    var usernameField = document.getElementById("usernameField");
    var logoutPanel = document.getElementById("logoutPanel");

    try {
        usernameField.innerHTML = authorizedCallHttp("username");
    } catch (error) {
        if (error.code === 404) {
            hide(logoutPanel);
            return;
        } else {
            throw error;
        }
    }

    var logoutButton = document.getElementById("logoutButton");
    logoutButton.addEventListener("click", function () {
        if (!stopRunningScripts()) {
            return;
        }

        try {
            authorizedCallHttp("logout", null, "POST");
        } catch (error) {
            if (error.code !== 405) {
                throw error;
            }
        }

        location.reload();
    });
}


function initWelcomeIcon() {
    var welcomeIcon = document.getElementById('welcome-icon');

    var originalSrc = welcomeIcon.src;
    var welcomeCookiePanel = document.getElementById('welcome-cookie-text');
    welcomeCookiePanel.addEventListener('mouseover', function () {
        welcomeIcon.src = 'images/cookie.png';
    });
    welcomeCookiePanel.addEventListener('mouseout', function () {
        welcomeIcon.src = originalSrc;
    });
}

function addRunningExecutor(scriptExecutor) {
    runningScriptExecutors.push(scriptExecutor);
    updateMenuItemState(scriptExecutor.scriptName);

    scriptExecutor.addListener({
        'onExecutionStop': function () {
            updateMenuItemState(scriptExecutor.scriptName);
        }
    })
}
function showScript(selectedScript) {
    if (!isNull(activeScriptController)) {
        var previousScriptName = activeScriptController.scriptName;
        var executorsToRemove = runningScriptExecutors.filter(function (executor) {
            return (executor.scriptName === previousScriptName) && executor.isFinished();
        });

        if (executorsToRemove.length > 0) {
            removeElements(runningScriptExecutors, executorsToRemove);

            updateMenuItemState(previousScriptName);
        }

        activeScriptController.destroy();
        activeScriptController = null;
    }

    var welcomePanel = document.getElementById('welcome-panel');
    var contentPanel = document.getElementById('content-panel');

    if (isNull(selectedScript)) {
        show(welcomePanel, 'flex');
        hide(contentPanel);
        return;
    }

    hide(welcomePanel);
    show(contentPanel);

    var scriptPanelContainer = document.getElementById('script-panel-container');
    destroyChildren(scriptPanelContainer);

    hideErrorPanel();

    var scriptHeader = document.getElementById('script-header');

    var scriptExecutor = findRunningExecutor(selectedScript);

    var scriptConfig;
    if (isNull(scriptExecutor)) {
        try {
            var rawConfig = authorizedCallHttp('scripts/info?name=' + selectedScript);
            scriptConfig = JSON.parse(rawConfig);
        } catch (error) {
            if (!(error instanceof HttpUnauthorizedError)) {
                logError(error);

                //noinspection JSDuplicatedDeclaration
                var errorPanel = showErrorPanel('Failed to load script info. Try to reload the page.'
                    + ' Error message:');
                errorPanel.appendChild(document.createElement('br'));
                errorPanel.appendChild(document.createTextNode(error.message));

                scriptHeader.innerText = selectedScript;
            }

            return;
        }
    } else {
        scriptConfig = scriptExecutor.scriptConfig;
    }

    scriptHeader.innerText = scriptConfig.name;

    var scriptController = new ScriptController(scriptConfig, function (scriptExecutor) {
        addRunningExecutor(scriptExecutor);
    });

    activeScriptController = scriptController;
    scriptController.fillView(scriptPanelContainer);

    if (!isNull(scriptExecutor)) {
        scriptController.setExecutor(scriptExecutor);
    }
}

function findRunningExecutor(selectedScript) {
    var scriptExecutor = null;
    runningScriptExecutors.forEach(function (executor) {
        if (executor.scriptName === selectedScript) {
            scriptExecutor = executor;
        }
    });
    return scriptExecutor;
}

function createParameterControl(parameter) {
    if (parameter.withoutValue) {
        return new Checkbox(parameter.name, parameter.default, parameter.description);

    } else if ((parameter.type === 'list') || (parameter.type === 'multiselect')) {
        return new Combobox(
            parameter.name,
            parameter.default,
            parameter.required,
            parameter.values,
            parameter.description,
            parameter.type === 'multiselect');

    } else if (parameter.type === 'file_upload') {
        return new FileUpload(
            parameter.name,
            parameter.description,
            parameter.required);

    } else {
        return new TextField(
            parameter.name,
            parameter.default,
            parameter.required,
            parameter.type,
            parameter.min,
            parameter.max,
            parameter.description,
            parameter.secure);
    }
}


function selectScript(scriptName) {
    selectedScript = scriptName;

    scriptSelectionListeners.forEach(function (listener) {
        listener(selectedScript);
    })
}

function getHash() {
    if (location.hash === 'undefined') {
        return null;
    }

    if (location.hash.length <= 1) {
        return null;
    }

    return decodeURIComponent(location.hash.substr(1));
}

function setButtonEnabled(button, enabled) {
    button.disabled = !enabled;
    if (!enabled) {
        addClass(button, "disabled");
    } else {
        removeClass(button, "disabled");
    }
}

function updateMenuItemState(scriptName) {
    var executing = false;
    var finished = false;

    runningScriptExecutors.forEach(function (executor) {
        if (executor.scriptName !== scriptName) {
            return;
        }

        if (executor.isFinished()) {
            finished = true;
        } else {
            executing = true;
        }
    });

    var state = null;
    if (executing) {
        state = 'executing';
    } else if (finished) {
        state = 'finished';
    }

    var menuItem = scriptMenuItems.get(scriptName);
    var stateElement = menuItem.stateElement;

    removeClass(stateElement, 'finished');
    removeClass(stateElement, 'executing');

    if (!isNull(state)) {
        addClass(stateElement, state);
    }
}

function getValidByTypeError(value, type, min, max) {
    if (type === 'int') {
        var isInteger = /^(((\-?[1-9])(\d*))|0)$/.test(value);
        if (!isInteger) {
            return getInvalidTypeError(type);
        }

        var intValue = parseInt(value);

        var minMaxValid = true;
        var minMaxError = "";
        if (!isNull(min)) {
            minMaxError += "min: " + min;

            if (intValue < parseInt(min)) {
                minMaxValid = false;
            }
        }

        if (!isNull(max)) {
            if (intValue > parseInt(max)) {
                minMaxValid = false;
            }

            if (!isEmptyString(minMaxError)) {
                minMaxError += ", ";
            }

            minMaxError += "max: " + max;
        }

        if (!minMaxValid) {
            return minMaxError;
        }

        return "";
    }

    return "";
}

function getInvalidTypeError(type) {
    if (type === 'int') {
        return "integer expected";
    }

    return type + " expected";
}

function authorizedCallHttp(url, object, method, asyncHandler) {
    try {
        return callHttp(url, object, method, asyncHandler);
    } catch (error) {
        if ((error instanceof HttpRequestError) && (error.code === 401)) {
            var link = document.createElement('a');
            link.innerHTML = 'relogin';
            link.addEventListener('click', function () {
                location.reload();
            });
            link.href = 'javascript:void(0)';

            var errorPanel = showErrorPanel('Credentials expired, please ');
            errorPanel.appendChild(link);

            throw new HttpUnauthorizedError(error.code, 'User is not authenticated');
        }

        throw error;
    }
}

function showErrorPanel(text) {
    var errorPanel = document.getElementById('error-panel');

    var scriptPanelContainer = document.getElementById('script-panel-container');
    addClass(scriptPanelContainer, 'collapsed');

    var hideThis = function () {
        hide(this);
    };
    $(scriptPanelContainer).find('.log-panel').each(hideThis);
    $(scriptPanelContainer).find('.script-input-panel').each(hideThis);
    $(scriptPanelContainer).find('.validation-panel').each(hideThis);

    destroyChildren(errorPanel);
    errorPanel.innerText = text;

    show(errorPanel);

    return errorPanel;
}

function hideErrorPanel() {
    var errorPanel = document.getElementById('error-panel');
    errorPanel.innerHTML = '';

    var scriptPanelContainer = document.getElementById('script-panel-container');
    removeClass(scriptPanelContainer, 'collapsed');

    hide(errorPanel);
}