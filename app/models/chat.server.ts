export const fetchBotResponse = async(userMessage: string)=>{
    try {
        const response = await fetch('',{
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(userMessage)
        })

        console.log(response, 'response')

        if(!response.ok){
            throw new Error(`http error status': ${response.status}`)
        }

         const data = await response.json()

         return data.response

    } catch (error) {
        console.log(error)
        return 'Something went wrong'
    }
} 