package com.jinvoice.ui.autoimport

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInAccount
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.Scope
import com.google.api.services.gmail.GmailScopes
import com.microsoft.identity.client.IAccount
import com.microsoft.identity.client.ISingleAccountPublicClientApplication
import com.microsoft.identity.client.IPublicClientApplication
import com.microsoft.identity.client.PublicClientApplication
import com.microsoft.identity.client.SignInParameters
import com.microsoft.identity.client.exception.MsalException
import com.jinvoice.R
import com.jinvoice.databinding.FragmentAutoimportSettingsBinding

class AutoImportSettingsFragment : Fragment() {

    private var _binding: FragmentAutoimportSettingsBinding? = null
    private val binding get() = _binding!!

    private val viewModel: AutoImportViewModel by viewModels()

    // --- Launchers ---

    private val consentLauncher: ActivityResultLauncher<Intent> =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val connectorType = pendingConsentType ?: return@registerForActivityResult
            if (result.resultCode == Activity.RESULT_OK) {
                viewModel.onConsentAccepted(connectorType)
            } else {
                viewModel.onConsentDeclined(connectorType)
            }
            pendingConsentType = null
        }

    private val gmailSignInLauncher: ActivityResultLauncher<Intent> =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode == Activity.RESULT_OK) {
                val account: GoogleSignInAccount? =
                    GoogleSignIn.getSignedInAccountFromIntent(result.data).result
                account?.email?.let { viewModel.onGmailSignedIn(it) }
            } else {
                viewModel.revokeGmail()
            }
        }

    private var pendingConsentType: String? = null

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentAutoimportSettingsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        observeState()
        observeEvents()

        binding.switchGmail.setOnCheckedChangeListener { _, isChecked ->
            viewModel.onGmailToggled(isChecked)
        }
        binding.switchOutlook.setOnCheckedChangeListener { _, isChecked ->
            viewModel.onOutlookToggled(isChecked)
        }

        binding.btnRevokeGmail.setOnClickListener { viewModel.revokeGmail() }
        binding.btnRevokeOutlook.setOnClickListener { viewModel.revokeOutlook() }
    }

    private fun observeState() {
        viewModel.gmailState.observe(viewLifecycleOwner) { state ->
            when (state) {
                is AutoImportViewModel.ConnectorState.Connected -> {
                    binding.switchGmail.isChecked = true
                    binding.tvGmailAccount.text = state.accountEmail
                    binding.tvGmailAccount.visibility = View.VISIBLE
                    binding.btnRevokeGmail.visibility = View.VISIBLE
                }
                AutoImportViewModel.ConnectorState.Disconnected -> {
                    binding.switchGmail.isChecked = false
                    binding.tvGmailAccount.visibility = View.GONE
                    binding.btnRevokeGmail.visibility = View.GONE
                }
            }
        }

        viewModel.outlookState.observe(viewLifecycleOwner) { state ->
            when (state) {
                is AutoImportViewModel.ConnectorState.Connected -> {
                    binding.switchOutlook.isChecked = true
                    binding.tvOutlookAccount.text = state.accountEmail
                    binding.tvOutlookAccount.visibility = View.VISIBLE
                    binding.btnRevokeOutlook.visibility = View.VISIBLE
                }
                AutoImportViewModel.ConnectorState.Disconnected -> {
                    binding.switchOutlook.isChecked = false
                    binding.tvOutlookAccount.visibility = View.GONE
                    binding.btnRevokeOutlook.visibility = View.GONE
                }
            }
        }
    }

    private fun observeEvents() {
        viewModel.event.observe(viewLifecycleOwner) { event ->
            when (event) {
                is AutoImportViewModel.UiEvent.ShowConsentScreen -> {
                    pendingConsentType = event.connectorType
                    val intent = when (event.connectorType) {
                        "gmail" -> ConsentActivity.intentForGmail(requireActivity())
                        else -> ConsentActivity.intentForOutlook(requireActivity())
                    }
                    consentLauncher.launch(intent)
                }
                AutoImportViewModel.UiEvent.StartGmailOAuth -> startGmailSignIn()
                AutoImportViewModel.UiEvent.StartOutlookOAuth -> startOutlookSignIn()
            }
        }
    }

    private fun startGmailSignIn() {
        val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestEmail()
            .requestScopes(Scope(GmailScopes.GMAIL_READONLY))
            .build()
        val client = GoogleSignIn.getClient(requireActivity(), gso)
        gmailSignInLauncher.launch(client.signInIntent)
    }

    private fun startOutlookSignIn() {
        PublicClientApplication.createSingleAccountPublicClientApplication(
            requireContext(),
            R.raw.msal_auth_config,
            object : IPublicClientApplication.ISingleAccountApplicationCreatedListener {
                override fun onCreated(app: ISingleAccountPublicClientApplication) {
                    val params = SignInParameters.builder()
                        .withActivity(requireActivity())
                        .withScopes(listOf("Mail.Read"))
                        .withCallback { result, exception ->
                            if (result != null) {
                                val email = result.account.username
                                val id = result.account.id
                                viewModel.onOutlookSignedIn(email, id)
                            } else {
                                viewModel.revokeOutlook()
                            }
                        }
                        .build()
                    app.signIn(params)
                }

                override fun onError(exception: MsalException) {
                    viewModel.revokeOutlook()
                }
            }
        )
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    companion object {
        fun newInstance() = AutoImportSettingsFragment()
    }
}
