import React, { useEffect, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { Button, Menu, Text } from 'react-native-paper'
import axios from 'axios'

export default function CompanyPicker({ apiBase, value, onChange }) {
  const [visible, setVisible] = useState(false)
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchCompanies()
  }, [])

  async function fetchCompanies() {
    setLoading(true)
    try {
      const res = await axios.get(`${apiBase}/api/company-names`)
      if (res.data && res.data.data) setCompanies(res.data.data.map(c => c.companyName))
    } catch (e) {
      console.warn('Could not fetch companies:', e.message)
    }
    setLoading(false)
  }

  const openMenu = () => setVisible(true)
  const closeMenu = () => setVisible(false)

  return (
    <View style={styles.row}>
      <Menu visible={visible} onDismiss={closeMenu} anchor={<Button onPress={openMenu}>{value || 'Choose company'}</Button>}>
        {loading && <Menu.Item title="Loading..." />}
        {!loading && companies.length === 0 && <Menu.Item title="No companies" />}
        {companies.map(c => (
          <Menu.Item key={c} onPress={() => { onChange(c); closeMenu() }} title={c} />
        ))}
      </Menu>
      <Button mode="outlined" onPress={fetchCompanies} compact>Refresh</Button>
    </View>
  )
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', gap: 8 } })
