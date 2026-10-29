const response = await fetch('/api/table/other.task?fields=%5B%22row_id%22,%22quantity%22%5D')
document.querySelector('#rows').textContent = JSON.stringify(await response.json(), null, 2)
