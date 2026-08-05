package com.jinvoice

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.jinvoice.databinding.ActivityMainBinding
import com.jinvoice.ui.autoimport.AutoImportSettingsFragment

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.bottomNav.setOnItemSelectedListener { item ->
            when (item.itemId) {
                R.id.nav_import -> {
                    supportFragmentManager.beginTransaction()
                        .replace(R.id.fragmentContainer, AutoImportSettingsFragment.newInstance())
                        .commit()
                    true
                }
                // Remaining destinations wired in subsequent phases
                else -> false
            }
        }

        // Default destination
        if (savedInstanceState == null) {
            binding.bottomNav.selectedItemId = R.id.nav_import
        }
    }
}
