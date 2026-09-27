import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import RecipeCard from '@/components/RecipeCard'
import RecipeFormDialog from '@/components/RecipeFormDialog'
import type { Recipe } from '@/types'

const BLOCK_COLORS = ['block-orange','block-blue','block-yellow','block-green','block-pink','block-purple','block-teal']

function App() {
  const [recipes, setRecipes] = useState<Recipe[]>(() => {
    const stored = localStorage.getItem('recipes')
    return stored ? JSON.parse(stored) : []
  })
  const [search, setSearch] = useState('')
  const [showFavouritesOnly, setShowFavouritesOnly] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null)

  useEffect(() => {
    localStorage.setItem('recipes', JSON.stringify(recipes))
  }, [recipes])

  const filteredRecipes = useMemo(() => {
    const q = search.trim().toLowerCase()
    return recipes.filter(r => {
      const matchesSearch = q === '' || r.name.toLowerCase().includes(q) || r.ingredients.some(ing => ing.name.toLowerCase().includes(q))
      return matchesSearch && (!showFavouritesOnly || r.favourite)
    })
  }, [recipes, search, showFavouritesOnly])

  const handleAddClick = () => {
    setEditingRecipe(null)
    setDialogOpen(true)
  }

  const handleEditClick = (recipe: Recipe) => {
    setEditingRecipe(recipe)
    setDialogOpen(true)
  }

  const handleSaveRecipe = (recipeData: Recipe) => {
    if (editingRecipe) {
      setRecipes(prev => prev.map(r => r.id === editingRecipe.id ? recipeData : r))
    } else {
      const newRecipe: Recipe = {
        ...recipeData,
        id: crypto.randomUUID(),
        blockColor: BLOCK_COLORS[recipes.length % BLOCK_COLORS.length],
      }
      setRecipes(prev => [...prev, newRecipe])
    }
    setDialogOpen(false)
    setEditingRecipe(null)
  }

  const handleDelete = (id: string) => {
    setRecipes(prev => prev.filter(r => r.id !== id))
  }

  const handleUpdateServings = (id: string, newServings: number) => {
    setRecipes(prev => prev.map(r => r.id === id ? { ...r, currentServings: Math.max(1, newServings) } : r))
  }

  const handleToggleFavourite = (id: string) => {
    setRecipes(prev => prev.map(r => r.id === id ? { ...r, favourite: !r.favourite } : r))
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b-2 border-border bg-accent">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <motion.h1
            initial={{ opacity: 0, y: -24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="text-display font-bold leading-none"
          >
            Recipe Box
          </motion.h1>
          <Button onClick={handleAddClick} className="bg-primary text-primary-foreground border-2 border-border">
            <Plus className="h-5 w-5" />
            Add recipe
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <section className="mb-8 flex flex-col sm:flex-row gap-4 items-end">
          <div className="flex-1">
            <Label htmlFor="search" className="mb-2 block">Search by name or ingredient</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" aria-hidden="true" />
              <Input
                id="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 border-2 border-border"
                placeholder="Type to search"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer border-2 border-border px-3 py-2 bg-white">
            <input
              type="checkbox"
              checked={showFavouritesOnly}
              onChange={(e) => setShowFavouritesOnly(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            <span className="text-sm font-semibold">Favourites only</span>
          </label>
        </section>

        {filteredRecipes.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-heading">{recipes.length === 0 ? 'No recipes yet. Add your first one!' : 'No recipes match your search.'}</p>
          </div>
        ) : (
          <motion.ul
            layout
            className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"
          >
            <AnimatePresence mode="popLayout">
              {filteredRecipes.map((recipe) => (
                <RecipeCard
                  key={recipe.id}
                  recipe={recipe}
                  onUpdateServings={handleUpdateServings}
                  onToggleFavourite={handleToggleFavourite}
                  onDelete={handleDelete}
                  onEdit={handleEditClick}
                />
              ))}
            </AnimatePresence>
          </motion.ul>
        )}
      </main>

      <footer className="border-t-2 border-border py-6 px-4 sm:px-6">
        <p className="text-sm text-center text-muted-foreground">
          Everything is stored in your browser. Nothing leaves this device.
        </p>
      </footer>

      <RecipeFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialRecipe={editingRecipe}
        onSave={handleSaveRecipe}
      />
    </div>
  )
}

export default App
