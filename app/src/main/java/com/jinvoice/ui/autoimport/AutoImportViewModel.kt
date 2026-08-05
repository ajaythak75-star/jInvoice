package com.jinvoice.ui.autoimport

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.viewModelScope
import com.jinvoice.data.prefs.AutoImportPreferences
import com.jinvoice.service.AutoImportWorker
import kotlinx.coroutines.launch

class AutoImportViewModel(application: Application) : AndroidViewModel(application) {

    private val prefs = AutoImportPreferences(application)

    private val _gmailState = MutableLiveData(ConnectorState.from(
        enabled = prefs.gmailEnabled,
        consentGiven = prefs.gmailConsentGiven,
        accountEmail = prefs.gmailAccountEmail,
    ))
    val gmailState: LiveData<ConnectorState> = _gmailState

    private val _outlookState = MutableLiveData(ConnectorState.from(
        enabled = prefs.outlookEnabled,
        consentGiven = prefs.outlookConsentGiven,
        accountEmail = prefs.outlookAccountEmail,
    ))
    val outlookState: LiveData<ConnectorState> = _outlookState

    private val _event = MutableLiveData<UiEvent>()
    val event: LiveData<UiEvent> = _event

    fun onGmailToggled(enabled: Boolean) {
        if (enabled && !prefs.gmailConsentGiven) {
            _event.value = UiEvent.ShowConsentScreen("gmail")
            return
        }
        prefs.gmailEnabled = enabled
        _gmailState.value = ConnectorState.from(enabled, prefs.gmailConsentGiven, prefs.gmailAccountEmail)
        rescheduleWorkerIfNeeded()
    }

    fun onOutlookToggled(enabled: Boolean) {
        if (enabled && !prefs.outlookConsentGiven) {
            _event.value = UiEvent.ShowConsentScreen("outlook")
            return
        }
        prefs.outlookEnabled = enabled
        _outlookState.value = ConnectorState.from(enabled, prefs.outlookConsentGiven, prefs.outlookAccountEmail)
        rescheduleWorkerIfNeeded()
    }

    fun onConsentAccepted(connectorType: String) {
        when (connectorType) {
            "gmail" -> {
                prefs.gmailEnabled = true
                _gmailState.value = ConnectorState.from(true, true, prefs.gmailAccountEmail)
                _event.value = UiEvent.StartGmailOAuth
            }
            "outlook" -> {
                prefs.outlookEnabled = true
                _outlookState.value = ConnectorState.from(true, true, prefs.outlookAccountEmail)
                _event.value = UiEvent.StartOutlookOAuth
            }
        }
        rescheduleWorkerIfNeeded()
    }

    fun onConsentDeclined(connectorType: String) {
        when (connectorType) {
            "gmail" -> {
                prefs.gmailEnabled = false
                _gmailState.value = ConnectorState.from(false, false, null)
            }
            "outlook" -> {
                prefs.outlookEnabled = false
                _outlookState.value = ConnectorState.from(false, false, null)
            }
        }
    }

    fun onGmailSignedIn(accountEmail: String) {
        prefs.gmailAccountEmail = accountEmail
        _gmailState.value = ConnectorState.from(true, true, accountEmail)
    }

    fun onOutlookSignedIn(accountEmail: String, accountId: String) {
        prefs.outlookAccountEmail = accountEmail
        prefs.outlookAccountId = accountId
        _outlookState.value = ConnectorState.from(true, true, accountEmail)
    }

    fun revokeGmail() {
        viewModelScope.launch {
            prefs.revokeGmail()
            _gmailState.value = ConnectorState.Disconnected
            rescheduleWorkerIfNeeded()
        }
    }

    fun revokeOutlook() {
        viewModelScope.launch {
            prefs.revokeOutlook()
            _outlookState.value = ConnectorState.Disconnected
            rescheduleWorkerIfNeeded()
        }
    }

    private fun rescheduleWorkerIfNeeded() {
        val ctx = getApplication<Application>()
        val anyEnabled = prefs.gmailEnabled || prefs.outlookEnabled
        if (anyEnabled) {
            AutoImportWorker.schedule(ctx)
        } else {
            AutoImportWorker.cancel(ctx)
        }
    }

    sealed class ConnectorState {
        data object Disconnected : ConnectorState()
        data class Connected(val accountEmail: String) : ConnectorState()

        companion object {
            fun from(enabled: Boolean, consentGiven: Boolean, accountEmail: String?) =
                if (enabled && consentGiven && !accountEmail.isNullOrBlank()) {
                    Connected(accountEmail)
                } else {
                    Disconnected
                }
        }
    }

    sealed class UiEvent {
        data class ShowConsentScreen(val connectorType: String) : UiEvent()
        data object StartGmailOAuth : UiEvent()
        data object StartOutlookOAuth : UiEvent()
    }
}
